import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("whatsapp_users")
    .select("id, display_name, phone_e164, email, role, global_role, status")
    .order("display_name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { display_name, phone_e164, email, global_role } = body;

  if (!display_name || !phone_e164) {
    return NextResponse.json({ error: "display_name and phone_e164 are required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("whatsapp_users")
    .insert({
      display_name,
      phone_e164,
      email: email || null,
      global_role: global_role || "member",
      role: "committee",
      status: "active",
      transcript_aliases: [display_name],
    })
    .select("id, display_name, phone_e164, email, role, global_role, status")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
