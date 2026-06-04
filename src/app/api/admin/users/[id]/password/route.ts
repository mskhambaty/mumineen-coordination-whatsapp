import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { hashPassword, isValidNewPassword } from "@/lib/admin/passwords";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// PUT: admin/leadership sets (overrides) a portal password for any user. Guarded by the admin
// key, same as the other /api/admin/users routes. Clears any pending reset token.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";

  if (!isValidNewPassword(password)) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const { data: user, error: lookupError } = await supabase
    .from("whatsapp_users")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const passwordHash = await hashPassword(password);
  const { error } = await supabase
    .from("whatsapp_users")
    .update({
      password_hash: passwordHash,
      password_updated_at: new Date().toISOString(),
      password_reset_token_hash: null,
      password_reset_expires_at: null,
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
