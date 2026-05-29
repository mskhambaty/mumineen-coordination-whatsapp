import { NextRequest, NextResponse } from "next/server";

import { resolveCallerFromRequest, ForbiddenError } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await resolveCallerFromRequest(req);
    const { id } = await params;
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("conversation_events")
      .select("id, event_type, sender_alias, message_text, message_timestamp, ai_summary, confidence, applied, task_id")
      .eq("upload_id", id)
      .order("message_timestamp", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
