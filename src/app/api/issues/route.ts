import { NextRequest, NextResponse } from "next/server";

import { AI_EMBEDDING_MODEL, getAIClient } from "@/lib/ai/model";
import { notifyDepartmentIssueContacts } from "@/lib/issues/notify";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { isTaskPriority } from "@/lib/tasks/types";

export const runtime = "nodejs";

// Two issues count as the same if their title+description embeddings are this close.
const DUPLICATE_SIMILARITY = 0.88;

type IssueBody = { title?: unknown; description?: unknown; priority?: unknown; department?: unknown };

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

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

  const departmentName = typeof body.department === "string" ? body.department.trim() : "";

  const supabase = getSupabaseAdmin();

  // Resolve department name to ID when provided.
  let departmentId: string | null = null;
  if (departmentName) {
    const { data: dept } = await supabase
      .from("departments")
      .select("id")
      .ilike("name", departmentName)
      .maybeSingle();
    departmentId = dept?.id ?? null;
  }

  // Link the reporter if we have a user record for this phone.
  const { data: reporter } = await supabase
    .from("whatsapp_users")
    .select("id")
    .eq("phone_e164", phone)
    .maybeSingle();

  // Dedupe: the agent sometimes logs the same problem twice (worded differently). If a
  // similar OPEN issue from this same chat already exists, return it instead of creating another.
  const newText = `${title}\n${description ?? ""}`.trim();
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from("tasks")
    .select("id, title, description, status, priority")
    .eq("item_type", "issue")
    .eq("source_phone", phone)
    .neq("status", "complete")
    .gte("created_at", since)
    .limit(10);

  if (recent && recent.length > 0) {
    try {
      const openai = getAIClient();
      const texts = [newText, ...recent.map((r) => `${r.title}\n${r.description ?? ""}`.trim())];
      const emb = await openai.embeddings.create({ model: AI_EMBEDDING_MODEL, input: texts });
      const [query, ...rest] = emb.data.map((d) => d.embedding);
      let bestIdx = -1;
      let best = 0;
      rest.forEach((vec, i) => {
        const sim = cosineSimilarity(query, vec);
        if (sim > best) {
          best = sim;
          bestIdx = i;
        }
      });
      if (bestIdx >= 0 && best >= DUPLICATE_SIMILARITY) {
        const match = recent[bestIdx];
        return NextResponse.json(
          { status: "duplicate", issue: { id: match.id, title: match.title, status: match.status, priority: match.priority } },
          { status: 200 },
        );
      }
    } catch (err) {
      console.error("Issue dedupe check failed; creating issue anyway", err);
    }
  }

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
      department_id: departmentId,
      created_by: reporter?.id ?? null,
      source_phone: phone,
    })
    .select("id, title, status, priority")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Notify the department's issue contacts (members with contact_for_issues) over email +
  // the department_ticket_assigned WhatsApp template. This is the create_issue path only —
  // escalation (move_to_escalation) notifies on-call support separately and independently.
  // Best-effort — a notification failure must never break issue creation.
  try {
    await notifyDepartmentIssueContacts({
      issueId: issue.id,
      title,
      description,
      departmentId,
    });
  } catch (err) {
    console.error("Issue notification failed:", err);
  }

  return NextResponse.json({ status: "created", issue }, { status: 201 });
}
