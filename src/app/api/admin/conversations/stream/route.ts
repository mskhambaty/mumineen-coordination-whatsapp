import { NextRequest } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// How often the server checks the cheap activity marker, and how long one SSE
// connection lives before the browser's EventSource transparently reconnects.
const CHECK_INTERVAL_MS = 4000;
const STREAM_DURATION_MS = 50_000;

// Cheapest possible "did anything change?" probe — newest last_message_at, which
// bumps on every inbound/outbound message (uses the last_message_at desc index).
async function activityMarker(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<string> {
  const { data } = await supabase
    .from("conversation_sessions")
    .select("last_message_at")
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.last_message_at ?? "";
}

export async function GET(req: NextRequest) {
  // EventSource cannot send custom headers, so the admin key arrives as a query
  // param (same value already exposed to the client as NEXT_PUBLIC_ADMIN_KEY).
  const key = req.nextUrl.searchParams.get("key");
  if (!process.env.ADMIN_API_KEY || key !== process.env.ADMIN_API_KEY) {
    return new Response("Unauthorized", { status: 401 });
  }

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
