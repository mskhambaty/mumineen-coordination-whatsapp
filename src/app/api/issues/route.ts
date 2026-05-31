import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { isTaskPriority } from "@/lib/tasks/types";

export const runtime = "nodejs";

type IssueBody = { title?: unknown; description?: unknown; priority?: unknown };

// External issue intake from the WhatsApp agent's create_issue tool. Creates an
// untriaged (no department) issue linked to the reporting guest. Open to any caller
// identified by x-whatsapp-from — escalation is the gated path, issues are low-stakes.
export async function POST(req: NextRequest) {
  const phone = req.headers.get("x-whatsapp-from");
  if (!phone) {
    return NextResponse.json({ error: "Missing x-whatsapp-from header" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as IssueBody;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const description = typeof body.description === "string" ? body.description.trim() || null : null;
  const priority = isTaskPriority(body.priority) ? body.priority : "medium";

  const supabase = getSupabaseAdmin();

  // Link the reporter if we have a user record for this phone.
  const { data: reporter } = await supabase
    .from("whatsapp_users")
    .select("id")
    .eq("phone_e164", phone)
    .maybeSingle();

  const { data: issue, error } = await supabase
    .from("tasks")
    .insert({
      title,
      description,
      item_type: "issue",
      origin: "external",
      source: "whatsapp_agent",
      status: "open",
      priority,
      department_id: null,
      created_by: reporter?.id ?? null,
    })
    .select("id, title, status, priority")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ status: "created", issue }, { status: 201 });
}
