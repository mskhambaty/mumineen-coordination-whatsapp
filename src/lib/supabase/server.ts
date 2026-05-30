import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requireEnv } from "@/lib/env";
import type { AppUser, UserRole } from "@/lib/permissions";
import type { IncomingWhatsAppMessage } from "@/lib/whatsapp/parser";

let supabaseAdmin: SupabaseClient | null = null;

export function getSupabaseAdmin() {
  if (!supabaseAdmin) {
    supabaseAdmin = createClient(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  }

  return supabaseAdmin;
}

export async function getOrCreateWhatsappUser(
  phoneE164: string,
  displayName?: string,
): Promise<AppUser> {
  const supabase = getSupabaseAdmin();

  const { data: existing, error: lookupError } = await supabase
    .from("whatsapp_users")
    .select("id, phone_e164, display_name, role, status")
    .eq("phone_e164", phoneE164)
    .maybeSingle();

  if (lookupError) {
    throw lookupError;
  }

  if (existing) {
    if (displayName && !existing.display_name) {
      await supabase
        .from("whatsapp_users")
        .update({ display_name: displayName })
        .eq("id", existing.id);
    }

    return {
      id: existing.id,
      phone_e164: existing.phone_e164,
      display_name: existing.display_name,
      role: existing.role as UserRole,
      status: existing.status,
    };
  }

  return {
    phone_e164: phoneE164,
    display_name: displayName ?? null,
    role: "visitor",
    status: "active",
  };
}

export async function recordInboundMessage(message: IncomingWhatsAppMessage) {
  const { data, error } = await getSupabaseAdmin()
    .from("messages")
    .insert({
      phone_e164: message.phoneE164,
      direction: "inbound",
      whatsapp_message_id: message.whatsappMessageId,
      body: message.body,
      message_type: message.messageType,
      raw_payload: message.rawMessage,
    })
    .select("id")
    .single();

  if (error?.code === "23505") {
    return { inserted: false, id: null };
  }

  if (error) {
    throw error;
  }

  return { inserted: true, id: data.id as string };
}

export async function recordOutboundMessage(input: {
  phoneE164: string;
  body: string;
  whatsappMessageId?: string;
  rawPayload?: unknown;
}) {
  const { error } = await getSupabaseAdmin().from("messages").insert({
    phone_e164: input.phoneE164,
    direction: "outbound",
    whatsapp_message_id: input.whatsappMessageId,
    body: input.body,
    message_type: "text",
    raw_payload: input.rawPayload,
  });

  if (error && error.code !== "23505") {
    throw error;
  }
}

export async function touchConversationSession(input: {
  phoneE164: string;
  userId?: string;
  currentIntent?: string | null;
  state?: Record<string, unknown>;
}) {
  const { error } = await getSupabaseAdmin().from("conversation_sessions").upsert(
    {
      phone_e164: input.phoneE164,
      user_id: input.userId,
      current_intent: input.currentIntent ?? null,
      state: input.state ?? {},
      last_message_at: new Date().toISOString(),
    },
    { onConflict: "phone_e164" },
  );

  if (error) {
    throw error;
  }
}

export async function recordToolAudit(input: {
  userId?: string;
  phoneE164: string;
  toolName: string;
  arguments: unknown;
  allowed: boolean;
  resultSummary?: string;
}) {
  const { error } = await getSupabaseAdmin().from("tool_audit_logs").insert({
    user_id: input.userId,
    phone_e164: input.phoneE164,
    tool_name: input.toolName,
    arguments: input.arguments,
    allowed: input.allowed,
    result_summary: input.resultSummary,
  });

  if (error) {
    console.error("Failed to write tool audit log", error);
  }
}
