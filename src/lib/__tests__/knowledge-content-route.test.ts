import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminKey = vi.fn();
const resolveCallerFromSession = vi.fn();
const getSupabaseAdmin = vi.fn();

// Keep the real auth module (UnauthorizedError, ADMIN_API_CALLER) so requirePortalCaller
// behaves like production; stub only the key check and session resolution.
vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return {
    ...actual,
    requireAdminKey: (...args: unknown[]) => requireAdminKey(...args),
    resolveCallerFromSession: (...args: unknown[]) => resolveCallerFromSession(...args),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => getSupabaseAdmin(),
}));

import { GET } from "@/app/api/knowledge/[id]/route";

const ID = "fab32c0b-f0a9-418f-a773-97ff5da7d79f";
const ctx = { params: Promise.resolve({ id: ID }) };

// Builder matching the route's two query chains:
//   from("knowledge_documents").select().eq().maybeSingle()
//   from(<content table>).select().eq().order()
function mockSupabase(opts: { doc: unknown; chunks: unknown }) {
  return {
    from(table: string) {
      if (table === "knowledge_documents") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: opts.doc, error: null }) }) }) };
      }
      return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: opts.chunks, error: null }) }) }) };
    },
  };
}

describe("GET /api/knowledge/[id]", () => {
  beforeEach(() => {
    requireAdminKey.mockReset();
    resolveCallerFromSession.mockReset();
    getSupabaseAdmin.mockReset();
  });

  it("returns 401 when neither admin key nor a portal session is present", async () => {
    requireAdminKey.mockReturnValue(false);
    const { UnauthorizedError } = await import("@/lib/api/auth");
    resolveCallerFromSession.mockRejectedValue(new UnauthorizedError("no session"));

    const res = await GET(new NextRequest("http://localhost/x"), ctx);
    expect(res.status).toBe(401);
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it("returns a logistics document's chunks in chunk-number order", async () => {
    requireAdminKey.mockReturnValue(true);
    getSupabaseAdmin.mockReturnValue(
      mockSupabase({
        doc: { id: ID, title: "WiFi access", store: "logistics", status: "indexed", chunk_count: 2 },
        // Out of order + lexical trap (chunk_10 before chunk_2) to prove numeric sort.
        chunks: [
          { section: "chunk_10", content: "tenth" },
          { section: "chunk_2", content: "second" },
        ],
      }),
    );

    const res = await GET(new NextRequest("http://localhost/x"), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("WiFi access");
    expect(body.chunks.map((c: { content: string }) => c.content)).toEqual(["second", "tenth"]);
  });

  it("returns 404 when the document does not exist", async () => {
    requireAdminKey.mockReturnValue(true);
    getSupabaseAdmin.mockReturnValue(mockSupabase({ doc: null, chunks: [] }));

    const res = await GET(new NextRequest("http://localhost/x"), ctx);
    expect(res.status).toBe(404);
  });
});
