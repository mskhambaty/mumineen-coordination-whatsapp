import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canAccessPortal } from "@/lib/admin/access";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requirePortalCaller } from "@/lib/api/portal-auth";

const CONTACT_SELECT = "id, department_id, name, role, phone_e164, email, notes, display_order, created_at, department:departments(name)";

const CreateSchema = z.object({
  department_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  role: z.string().max(200).nullable().optional(),
  phone_e164: z.string().max(30).nullable().optional(),
  email: z.string().email().max(300).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  display_order: z.number().int().min(0).max(999).optional(),
});

// GET: list department contacts, optionally filtered by department_id.
export async function GET(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const departmentId = searchParams.get("department_id");

  let query = getSupabaseAdmin()
    .from("department_contacts")
    .select(CONTACT_SELECT)
    .order("department_id", { ascending: true })
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (departmentId) {
    query = query.eq("department_id", departmentId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ contacts: data ?? [] });
}

// POST: add a contact for a department.
export async function POST(req: NextRequest) {
  const auth = await requirePortalCaller(req, canAccessPortal);
  if (auth instanceof NextResponse) return auth;

  const parsed = CreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin()
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

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ contact: data }, { status: 201 });
}
