import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canAccessPortal } from "@/lib/admin/access";
import { sendAdminWelcomeNotification } from "@/lib/admin/onboarding";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requirePortalCaller } from "@/lib/api/portal-auth";

const CONTACT_SELECT = "id, department_id, name, role, phone_e164, email, notes, display_order, created_at, department:departments(name)";

// A department contact is one of two things:
//  • "reference" — a freestanding department_contacts row (an external person, no portal account)
//  • "member"    — a whatsapp_users portal user flagged as a department issue contact
//                  (department_members.contact_for_issues = true)
// The GET merges both; the POST can create either, and can provision a new/existing user as a member.

const DEPT_ROLES = ["member", "pm", "hod"] as const;
const DEPT_ROLE_LABEL: Record<string, string> = { hod: "HOD", pm: "PM", member: "Member" };

// Reference contact — the original behavior. `mode` is optional for backward compatibility.
const ReferenceSchema = z.object({
  mode: z.literal("reference").optional(),
  department_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  role: z.string().max(200).nullable().optional(),
  phone_e164: z.string().max(30).nullable().optional(),
  email: z.string().email().max(300).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  display_order: z.number().int().min(0).max(999).optional(),
});

// Flag an existing department member as an issue contact. This only sets contact_for_issues on a
// membership that already exists — adding a user to a department (and their role) is managed on the
// Departments page, not here.
const ExistingUserSchema = z.object({
  mode: z.literal("existing_user"),
  department_id: z.string().uuid(),
  user_id: z.string().uuid(),
});

// Create a new portal user and flag them as a department issue contact.
const NewUserSchema = z.object({
  mode: z.literal("new_user"),
  department_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  phone_e164: z.string().min(5).max(30),
  email: z.string().email().max(300).nullable().optional(),
  dept_role: z.enum(DEPT_ROLES).optional(),
  send_welcome: z.boolean().optional(),
});

type MemberUser = { id: string; display_name: string | null; email: string | null; phone_e164: string | null };

function memberContact(membershipId: string, departmentId: string, departmentName: string | null, deptRole: string, user: MemberUser) {
  return {
    kind: "member" as const,
    id: membershipId,
    membership_id: membershipId,
    user_id: user.id,
    department_id: departmentId,
    department: departmentName ? { name: departmentName } : null,
    name: user.display_name,
    role: DEPT_ROLE_LABEL[deptRole] ?? deptRole,
    dept_role: deptRole,
    phone_e164: user.phone_e164,
    email: user.email,
    notes: null,
  };
}

// GET: list department contacts — both reference rows and member (portal user) contacts.
// Optionally filtered by department_id.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;

  const supabase = getSupabaseAdmin();
  const departmentId = new URL(req.url).searchParams.get("department_id");

  let refQuery = supabase
    .from("department_contacts")
    .select(CONTACT_SELECT)
    .order("department_id", { ascending: true })
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (departmentId) refQuery = refQuery.eq("department_id", departmentId);

  let memberQuery = supabase
    .from("department_members")
    .select("id, department_id, dept_role, department:departments(name), user:whatsapp_users(id, display_name, email, phone_e164)")
    .eq("is_active", true)
    .eq("contact_for_issues", true);
  if (departmentId) memberQuery = memberQuery.eq("department_id", departmentId);

  const [{ data: refData, error: refErr }, { data: memberData, error: memberErr }] = await Promise.all([
    refQuery,
    memberQuery,
  ]);
  if (refErr) return NextResponse.json({ error: refErr.message }, { status: 500 });
  if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 500 });

  type MemberRow = {
    id: string;
    department_id: string;
    dept_role: string;
    department: { name: string } | { name: string }[] | null;
    user: MemberUser | MemberUser[] | null;
  };

  const references = (refData ?? []).map((c) => ({ ...c, kind: "reference" as const }));
  const members = ((memberData ?? []) as unknown as MemberRow[])
    .map((row) => {
      const user = Array.isArray(row.user) ? row.user[0] : row.user;
      if (!user) return null;
      const dept = Array.isArray(row.department) ? row.department[0] : row.department;
      return memberContact(row.id, row.department_id, dept?.name ?? null, row.dept_role, user);
    })
    .filter(Boolean);

  return NextResponse.json({ contacts: [...references, ...members] });
}

// POST: add a department contact. Defaults to a reference row; mode "existing_user"/"new_user"
// instead flags a portal user (existing or newly created) as a department issue contact.
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;

  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const mode = typeof raw.mode === "string" ? raw.mode : "reference";
  const supabase = getSupabaseAdmin();

  if (mode === "reference") {
    const parsed = ReferenceSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("department_contacts")
      .insert({
        department_id: parsed.data.department_id,
        name: parsed.data.name,
        role: parsed.data.role ?? null,
        phone_e164: parsed.data.phone_e164 ?? null,
        email: parsed.data.email ?? null,
        notes: parsed.data.notes ?? null,
        display_order: parsed.data.display_order ?? 0,
      })
      .select(CONTACT_SELECT)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ contact: { ...data, kind: "reference" } }, { status: 201 });
  }

  // Both member modes end with a department_members issue-contact row, but they differ: existing_user
  // only flags a membership that already exists, while new_user provisions the user + membership.
  let userId: string;
  let deptRole: string;
  let departmentId: string;
  let membershipId: string;

  if (mode === "existing_user") {
    const parsed = ExistingUserSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    userId = parsed.data.user_id;
    departmentId = parsed.data.department_id;

    // Membership must already exist — we only flag it. (Department membership is managed elsewhere.)
    const { data: membership } = await supabase
      .from("department_members")
      .select("id, dept_role")
      .eq("user_id", userId)
      .eq("department_id", departmentId)
      .maybeSingle();
    if (!membership) {
      return NextResponse.json(
        { error: "That user isn't a member of this department. Add them on the Departments page first." },
        { status: 400 },
      );
    }
    const { data, error } = await supabase
      .from("department_members")
      .update({ contact_for_issues: true, is_active: true })
      .eq("id", membership.id)
      .select("id")
      .single();
    if (error || !data) return NextResponse.json({ error: error?.message ?? "Failed to update membership" }, { status: 500 });
    membershipId = data.id as string;
    deptRole = membership.dept_role as string;
  } else if (mode === "new_user") {
    const parsed = NewUserSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    departmentId = parsed.data.department_id;
    deptRole = parsed.data.dept_role ?? "member";
    const phone = parsed.data.phone_e164.trim();

    // Reuse an existing portal user with this phone instead of creating a duplicate.
    const { data: existingUser } = await supabase
      .from("whatsapp_users")
      .select("id")
      .eq("phone_e164", phone)
      .maybeSingle();
    if (existingUser) {
      userId = existingUser.id as string;
    } else {
      const { data: created, error: createErr } = await supabase
        .from("whatsapp_users")
        .insert({
          display_name: parsed.data.name,
          phone_e164: phone,
          email: parsed.data.email ?? null,
          role: "committee",
          global_role: "member",
          status: "active",
          transcript_aliases: [parsed.data.name],
        })
        .select("id")
        .single();
      if (createErr || !created) {
        return NextResponse.json({ error: createErr?.message ?? "Failed to create user" }, { status: 500 });
      }
      userId = created.id as string;
    }

    if (parsed.data.send_welcome) {
      await sendAdminWelcomeNotification({ userId, departmentId }).catch(() => undefined);
    }

    // Create or reactivate the membership as an active issue contact.
    const { data: existingM } = await supabase
      .from("department_members")
      .select("id")
      .eq("user_id", userId)
      .eq("department_id", departmentId)
      .maybeSingle();
    if (existingM) {
      const { data, error } = await supabase
        .from("department_members")
        .update({ is_active: true, contact_for_issues: true, dept_role: deptRole })
        .eq("id", existingM.id)
        .select("id")
        .single();
      if (error || !data) return NextResponse.json({ error: error?.message ?? "Failed to update membership" }, { status: 500 });
      membershipId = data.id as string;
    } else {
      const { data, error } = await supabase
        .from("department_members")
        .insert({ user_id: userId, department_id: departmentId, dept_role: deptRole, is_active: true, contact_for_issues: true })
        .select("id")
        .single();
      if (error || !data) return NextResponse.json({ error: error?.message ?? "Failed to add membership" }, { status: 500 });
      membershipId = data.id as string;
    }
  } else {
    return NextResponse.json({ error: `Unknown mode '${mode}'` }, { status: 400 });
  }

  // Build the response contact from the now-current user + department.
  const [{ data: user }, { data: dept }] = await Promise.all([
    supabase.from("whatsapp_users").select("id, display_name, email, phone_e164").eq("id", userId).single(),
    supabase.from("departments").select("name").eq("id", departmentId).single(),
  ]);
  if (!user) return NextResponse.json({ error: "User not found after upsert" }, { status: 500 });

  return NextResponse.json(
    { contact: memberContact(membershipId, departmentId, dept?.name ?? null, deptRole, user as MemberUser) },
    { status: 201 },
  );
}
