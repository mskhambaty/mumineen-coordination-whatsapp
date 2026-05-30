import { NextRequest, NextResponse } from "next/server";

import { ForbiddenError, resolveCallerFromRequest } from "@/lib/api/auth";
import { toolDefinitions } from "@/lib/agent/tools";
import { getToolApiMapping } from "@/lib/agent/tool-metadata";

export async function GET(req: NextRequest) {
  try {
    const caller = await resolveCallerFromRequest(req);
    if (!caller.can_read_all) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const apiMap = getToolApiMapping();

    const tools = toolDefinitions
      .filter((tool): tool is typeof tool & { type: "function" } => tool.type === "function")
      .map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
        internal_api: apiMap[tool.function.name] ?? "Unknown",
      }));

    return NextResponse.json({ tools });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
