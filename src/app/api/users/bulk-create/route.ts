import { NextRequest, NextResponse } from "next/server";

import { ForbiddenError, guardWriteAccess, resolveCallerFromRequest } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type BulkMemberInput = {
  display_name?: unknown;
  phone_e164?: unknown;
  email?: unknown;
  department_id?: unknown;
  dept_role?: unknown;
  transcript_aliases?: unknown;
};

type BulkCreateBody = {
  members?: unknown;
};

type CreatedMember = {
  user_id: string;
  membership_id: string | null;
  display_name: string;
};

const deptRoles = new Set(["hod", "pm", "member"]);

export async function POST(req: NextRequest) {
  try {
    const caller = await resolveCallerFromRequest(req);
    const body = (await req.json()) as BulkCreateBody;

    if (!Array.isArray(body.members) || body.members.length === 0) {
      return NextResponse.json({ error: "members array is required" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const created: CreatedMember[] = [];

    for (const rawMember of body.members as BulkMemberInput[]) {
      const member = normalizeMember(rawMember);
      if (!member) {
        return NextResponse.json({ error: "Each member requires display_name, phone_e164, department_id, and dept_role" }, { status: 400 });
      }

      guardWriteAccess(caller, member.department_id);

      const { data: user, error: userError } = await supabase
        .from("whatsapp_users")
        .upsert(
          {
            display_name: member.display_name,
            phone_e164: member.phone_e164,
            email: member.email,
            role: "committee",
            global_role: "member",
            status: "active",
            transcript_aliases: member.transcript_aliases,
          },
          { onConflict: "phone_e164" },
        )
        .select("id, display_name")
        .single();

      if (userError || !user) {
        return NextResponse.json({ error: userError?.message ?? "Failed to create user" }, { status: 500 });
      }

      const { data: membership, error: membershipError } = await supabase
        .from("department_members")
        .upsert(
          {
            user_id: user.id,
            department_id: member.department_id,
            dept_role: member.dept_role,
            is_active: true,
          },
          { onConflict: "department_id,user_id" },
        )
        .select("id")
        .maybeSingle();

      if (membershipError) {
        return NextResponse.json({ error: membershipError.message }, { status: 500 });
      }

      created.push({
        user_id: user.id as string,
        membership_id: (membership?.id as string | undefined) ?? null,
        display_name: (user.display_name as string | null) ?? member.display_name,
      });
    }

    return NextResponse.json({ created }, { status: 201 });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}

function normalizeMember(input: BulkMemberInput) {
  const displayName = getString(input.display_name);
  const phoneE164 = getString(input.phone_e164);
  const email = getString(input.email) ?? null;
  const departmentId = getString(input.department_id);
  const deptRole = getString(input.dept_role);

  if (!displayName || !phoneE164 || !departmentId || !deptRole || !deptRoles.has(deptRole)) {
    return null;
  }

  const aliases = Array.isArray(input.transcript_aliases)
    ? input.transcript_aliases.filter((alias): alias is string => typeof alias === "string" && alias.trim().length > 0)
    : [];

  return {
    display_name: displayName,
    phone_e164: phoneE164,
    email,
    department_id: departmentId,
    dept_role: deptRole as "hod" | "pm" | "member",
    transcript_aliases: Array.from(new Set([displayName, ...aliases].map((alias) => alias.trim()))),
  };
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
