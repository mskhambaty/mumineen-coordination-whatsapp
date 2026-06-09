import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canAccessPortal } from "@/lib/admin/access";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requirePortalCaller } from "@/lib/api/portal-auth";

type RouteContext = { params: Promise<{ id: string }> };

const CONTACT_SELECT = "id, department_id, name, role, phone_e164, email, notes, display_order, created_at, department:departments(name)";

const UpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  role: z.string().max(200).nullable().optional(),
  phone_e164: z.string().max(30).nullable().optional(),
  email: z.string().email().max(300).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  display_order: z.number().int().min(0).max(999).optional(),
});

// PUT: update a department contact.
export async function PUT(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const parsed = UpdateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.role !== undefined) updates.role = parsed.data.role;
  if (parsed.data.phone_e164 !== undefined) updates.phone_e164 = parsed.data.phone_e164;
  if (parsed.data.email !== undefined) updates.email = parsed.data.email;
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;
  if (parsed.data.display_order !== undefined) updates.display_order = parsed.data.display_order;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("department_contacts")
    .update(updates)
    .eq("id", id)
    .select(CONTACT_SELECT)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  return NextResponse.json({ contact: data });
}

// DELETE: remove a department contact.
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const { error } = await getSupabaseAdmin()
    .from("department_contacts")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
