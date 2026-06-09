import { NextRequest, NextResponse } from "next/server";

import { canAccessInbox } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// How often the server checks the cheap activity marker, and how long one SSE
// connection lives before the browser's EventSource transparently reconnects.
const CHECK_INTERVAL_MS = 4000;
const STREAM_DURATION_MS = 50_000;

// Cheapest possible "did anything change?" probe for the triage desk.
// We take the most recent of:
//   1. Latest escalation_assigned_at (active escalations only, stage != 'none')
//   2. Latest escalated_at (any session)
//   3. Latest created_at from escalation_activity_log
async function activityMarker(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<string> {
  const [assignedRes, escalatedRes, activityRes] = await Promise.all([
    supabase
      .from("conversation_sessions")
      .select("escalation_assigned_at")
      .neq("escalation_stage", "none")
      .not("escalation_assigned_at", "is", null)
      .order("escalation_assigned_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("conversation_sessions")
      .select("escalated_at")
      .not("escalated_at", "is", null)
      .order("escalated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("escalation_activity_log")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const candidates = [
    assignedRes.data?.escalation_assigned_at ?? "",
    escalatedRes.data?.escalated_at ?? "",
    activityRes.data?.created_at ?? "",
  ].filter(Boolean);

  return candidates.length > 0 ? candidates.sort().at(-1)! : "";
}

export async function GET(req: NextRequest) {
  // EventSource can't send custom headers, but the browser attaches the
  // httpOnly session cookie automatically on same-origin requests.
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const supabase = getSupabaseAdmin();
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      send("ready", { ok: true });
      let last = await activityMarker(supabase);
      const startedAt = Date.now();

      while (!closed && Date.now() - startedAt < STREAM_DURATION_MS) {
        await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS));
        if (closed) break;
        const current = await activityMarker(supabase);
        if (current !== last) {
          last = current;
          send("changed", { at: current });
        } else {
          send("ping", {}); // keep-alive so proxies don't drop the connection
        }
      }

      if (!closed) {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
