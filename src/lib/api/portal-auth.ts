import { NextResponse } from "next/server";

import { PortalUser } from "@/lib/admin/access";
import {
  ADMIN_API_CALLER,
  CallerContext,
  requireAdminKey,
  resolveCallerFromSession,
  UnauthorizedError,
} from "@/lib/api/auth";

// Route-level portal guard. Pass the same predicate the page gate uses
// (src/lib/admin/access.ts) so UI visibility and API authorization agree.
// Returns a NextResponse (401/403) to short-circuit, or the resolved caller.
export async function requirePortalCaller(
  req: Request,
  predicate: (user: PortalUser) => boolean,
): Promise<{ caller: CallerContext } | NextResponse> {
  // Server-to-server (agent, cron) — full access; key is no longer in any client bundle.
  if (requireAdminKey(req)) {
    return { caller: ADMIN_API_CALLER };
  }

  let caller: CallerContext;
  try {
    caller = await resolveCallerFromSession(req);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Infra failure (e.g. permissions RPC) — don't masquerade as an auth failure,
    // or the client would clear the session and bounce the user to login.
    console.error("requirePortalCaller: failed to resolve session caller", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  if (!caller.portal || !predicate(caller.portal)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return { caller };
}
