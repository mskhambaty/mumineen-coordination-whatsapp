import { NextRequest, NextResponse } from "next/server";

import { resolveCallerFromPhone } from "@/lib/api/auth";

export async function GET(req: NextRequest) {
  try {
    const phone = req.headers.get("x-whatsapp-from");
    if (!phone) {
      return NextResponse.json({ error: "Missing x-whatsapp-from header" }, { status: 401 });
    }

    const caller = await resolveCallerFromPhone(phone);
    return NextResponse.json(caller);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
