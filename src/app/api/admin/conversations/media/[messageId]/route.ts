import { NextRequest, NextResponse } from "next/server";

import { canAccessInbox } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { fetchWhatsAppMedia } from "@/lib/meta/whatsapp";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Serve a WhatsApp image for the inbox. The bytes live behind Meta's authenticated
// media API, so we proxy them on demand by the message's stored media id.
// The browser attaches the httpOnly session cookie automatically on same-origin requests.
export async function GET(req: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const { messageId } = await params;
  const { data: message } = await getSupabaseAdmin()
    .from("messages")
    .select("raw_payload")
    .eq("id", messageId)
    .maybeSingle();

  const mediaId = extractMediaId(message?.raw_payload);
  if (!mediaId) {
    return new Response("No media for this message", { status: 404 });
  }

  try {
    const { buffer, mimeType } = await fetchWhatsAppMedia(mediaId);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": mimeType,
        // Media is immutable per message; cache in the browser to avoid re-fetching.
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch {
    return new Response("Media unavailable", { status: 502 });
  }
}

// Inbound images store the id under message.image.id; admin-sent images store media_id.
function extractMediaId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const outbound = typeof obj.media_id === "string" ? obj.media_id : null;
  if (outbound) return outbound;
  const inner = obj.message as { image?: { id?: unknown } } | undefined;
  const inboundId = inner?.image?.id;
  return typeof inboundId === "string" ? inboundId : null;
}
