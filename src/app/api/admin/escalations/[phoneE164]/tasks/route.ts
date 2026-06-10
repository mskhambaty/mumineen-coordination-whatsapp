import { NextRequest, NextResponse } from "next/server";

import { canAccessInbox } from "@/lib/admin/access";
import { requirePortalCaller } from "@/lib/api/portal-auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ phoneE164: string }> };

// Returns tasks linked to this conversation (via linked_task_id) plus any
// historically created from this phone (source_phone).
export async function GET(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canAccessInbox);
  if (auth instanceof NextResponse) return auth;

  const { phoneE164 } = await params;
  const phone = decodeURIComponent(phoneE164);

  const supabase = getSupabaseAdmin();

  // Get the linked_task_id for this conversation.
  const { data: session } = await supabase
    .from("conversation_sessions")
    .select("linked_task_id")
    .eq("phone_e164", phone)
    .maybeSingle();

  const linkedTaskId = session?.linked_task_id ?? null;

  // Fetch tasks: linked + any from this phone.
  let query = supabase
    .from("tasks")
    .select("id, title, status, priority, item_type, department_id, created_at, source_phone, department:departments(name)")
    .eq("item_type", "issue")
    .order("created_at", { ascending: false })
    .limit(20);

  if (linkedTaskId) {
    query = query.or(`id.eq.${linkedTaskId},source_phone.eq.${phone}`);
  } else {
    query = query.eq("source_phone", phone);
  }

  const { data: tasks, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // For each task, count how many conversations are linked to it.
  const taskIds = (tasks ?? []).map((t: { id: string }) => t.id);
  let linkCounts: Record<string, number> = {};
  if (taskIds.length > 0) {
    const { data: counts } = await supabase
      .from("conversation_sessions")
      .select("linked_task_id")
      .in("linked_task_id", taskIds);

    linkCounts = (counts ?? []).reduce(
      (acc: Record<string, number>, row: { linked_task_id: string | null }) => {
        if (row.linked_task_id) acc[row.linked_task_id] = (acc[row.linked_task_id] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
  }

  type TaskRow = {
    id: string;
    title: string;
    status: string;
    priority: string;
    item_type: string;
    department_id: string | null;
    created_at: string;
    source_phone: string | null;
    department: { name: string } | { name: string }[] | null;
  };

  const result = (tasks ?? []).map((t: TaskRow) => {
    const dept = Array.isArray(t.department) ? t.department[0] : t.department;
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      item_type: t.item_type,
      department_name: dept?.name ?? null,
      created_at: t.created_at,
      is_linked: t.id === linkedTaskId,
      linked_conversation_count: linkCounts[t.id] ?? 0,
    };
  });

  return NextResponse.json({ tasks: result });
}
