import { NextRequest, NextResponse } from "next/server";

import { resolveCallerFromRequest, ForbiddenError } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  try {
    await resolveCallerFromRequest(req);
    const supabase = getSupabaseAdmin();

    const alias = req.nextUrl.searchParams.get("alias");
    if (!alias) {
      return NextResponse.json({ error: "alias query parameter is required" }, { status: 400 });
    }

    // Case-insensitive search using ilike on transcript_aliases array
    const { data, error } = await supabase
      .from("whatsapp_users")
      .select("id, display_name, phone_e164")
      .contains("transcript_aliases", [alias]);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ found: false });
    }

    return NextResponse.json({ found: true, user: data[0] });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
