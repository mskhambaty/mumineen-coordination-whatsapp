import { NextRequest, NextResponse } from "next/server";

import { ForbiddenError, resolveCallerFromRequest } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  try {
    await resolveCallerFromRequest(req);
    const departmentIds = req.nextUrl.searchParams.get("department_ids")?.split(",").filter(Boolean) ?? [];

    if (departmentIds.length === 0) {
      return NextResponse.json({ last_message_at: null });
    }

    const supabase = getSupabaseAdmin();

    const { data } = await supabase
      .from("conversation_uploads")
      .select("last_message_at")
      .in("department_id", departmentIds)
      .not("last_message_at", "is", null)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({ last_message_at: data?.last_message_at ?? null });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
