import { NextRequest, NextResponse } from "next/server";

import { canManageKnowledge } from "@/lib/admin/access";
import { ForbiddenError, resolveCallerFromRequest } from "@/lib/api/auth";
import { allToolDefinitions } from "@/lib/agent/tools";
import { getToolMetadata } from "@/lib/agent/tool-metadata";

export async function GET(req: NextRequest) {
  try {
    const caller = await resolveCallerFromRequest(req);
    if (!caller.can_read_all && !canManageKnowledge(caller.portal)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const metadataMap = getToolMetadata();

    const tools = allToolDefinitions
      .filter((tool): tool is typeof tool & { type: "function" } => tool.type === "function")
      .map((tool) => {
        const metadata = metadataMap[tool.function.name];

        return {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
          internal_api: metadata?.internal_api ?? "Unknown",
          audience: metadata?.audience ?? "internal",
          availability: metadata?.availability ?? "not_connected",
          status_label: metadata?.status_label ?? "Unknown",
          status_note: metadata?.status_note ?? "Metadata has not been configured for this tool.",
        };
      });

    return NextResponse.json({ tools });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
