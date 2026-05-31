import { NextRequest, NextResponse } from "next/server";

import { ForbiddenError, resolveCallerFromRequest } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  try {
    await resolveCallerFromRequest(req);
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("tasks")
      .select("milestone_id, item_type")
      .eq("archived", false)
      .neq("status", "complete")
      .not("milestone_id", "is", null);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const counts = new Map<string, { open_tasks: number; open_issues: number }>();
    for (const row of data ?? []) {
      const msId = row.milestone_id as string;
      if (!counts.has(msId)) counts.set(msId, { open_tasks: 0, open_issues: 0 });
      const entry = counts.get(msId)!;
      if (row.item_type === "issue") entry.open_issues++;
      else entry.open_tasks++;
    }

    const result = Array.from(counts.entries()).map(([milestone_id, c]) => ({
      milestone_id,
      ...c,
    }));

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
