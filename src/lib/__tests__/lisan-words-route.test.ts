import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePortalCaller: vi.fn(),
  addLisanWord: vi.fn(),
  listAllLisanWords: vi.fn(),
  countLisanWords: vi.fn(),
  listLisanWordsPage: vi.fn(),
  updateLisanWordById: vi.fn(),
  deleteLisanWordById: vi.fn(),
}));

vi.mock("@/lib/api/portal-auth", () => ({
  requirePortalCaller: (...args: unknown[]) => mocks.requirePortalCaller(...args),
}));

vi.mock("@/lib/knowledge/lisan-words", () => ({
  addLisanWord: (...args: unknown[]) => mocks.addLisanWord(...args),
  listAllLisanWords: (...args: unknown[]) => mocks.listAllLisanWords(...args),
  countLisanWords: (...args: unknown[]) => mocks.countLisanWords(...args),
  listLisanWordsPage: (...args: unknown[]) => mocks.listLisanWordsPage(...args),
  updateLisanWordById: (...args: unknown[]) => mocks.updateLisanWordById(...args),
  deleteLisanWordById: (...args: unknown[]) => mocks.deleteLisanWordById(...args),
  importLisanWords: vi.fn(),
}));

vi.mock("@/lib/util/csv", () => ({ parseCsv: vi.fn() }));

import { DELETE, GET, PATCH, PUT } from "@/app/api/admin/lisan-words/route";

const CALLER = { caller: { id: "admin1", role: "admin", display_name: "Admin" } };
const req = (url: string, init?: RequestInit) => new NextRequest(url, init);
const putReq = (body: unknown) =>
  req("http://localhost/api/admin/lisan-words", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePortalCaller.mockResolvedValue(CALLER); // authorized by default
});

describe("PUT /api/admin/lisan-words (single add)", () => {
  it("rejects an unauthorized caller before touching the DB", async () => {
    mocks.requirePortalCaller.mockResolvedValue(NextResponse.json({ error: "no" }, { status: 401 }));
    const res = await PUT(putReq({ transliteration: "Aflaak", lisan: "افلاك", meaning: "Spheres" }));
    expect(res.status).toBe(401);
    expect(mocks.addLisanWord).not.toHaveBeenCalled();
  });

  it("adds a new word and returns 201 with the new count", async () => {
    mocks.addLisanWord.mockResolvedValue({ status: "added", entry: { transliteration: "Aflaak" }, count: 42 });
    const res = await PUT(putReq({ transliteration: "Aflaak", lisan: "افلاك", meaning: "Celestial spheres", example: "" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ status: "added", count: 42 });
    expect(mocks.addLisanWord).toHaveBeenCalledWith(
      expect.objectContaining({ transliteration: "Aflaak", lisan: "افلاك", meaning: "Celestial spheres" }),
      "Admin", // caller display name, for the "word added" email
      { confirm: false }, // first attempt is unconfirmed (warn-before-overwrite)
    );
  });

  it("returns 409 + the existing entry when a duplicate is added without confirm", async () => {
    mocks.addLisanWord.mockResolvedValue({
      status: "exists",
      existing: { id: 5, transliteration: "Aflaak", lisan: "افلاك", meaning: "Old meaning", example: null },
    });
    const res = await PUT(putReq({ transliteration: "Aflaak", meaning: "New meaning" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ status: "exists", existing: { id: 5, meaning: "Old meaning" } });
  });

  it("overwrites when confirm:true is passed", async () => {
    mocks.addLisanWord.mockResolvedValue({ status: "updated", entry: { transliteration: "Aflaak" }, count: 9 });
    const res = await PUT(putReq({ transliteration: "Aflaak", meaning: "New meaning", confirm: true }));
    expect(res.status).toBe(200);
    expect(mocks.addLisanWord).toHaveBeenCalledWith(expect.any(Object), "Admin", { confirm: true });
  });
});

describe("PATCH /api/admin/lisan-words (edit by id)", () => {
  const patchReq = (body: unknown) =>
    req("http://localhost/api/admin/lisan-words", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("edits a word by id", async () => {
    mocks.updateLisanWordById.mockResolvedValue({ status: "updated", entry: { transliteration: "Aflaak" } });
    const res = await PATCH(patchReq({ id: 5, transliteration: "Aflaak", meaning: "Fixed" }));
    expect(res.status).toBe(200);
    expect(mocks.updateLisanWordById).toHaveBeenCalledWith(5, expect.objectContaining({ meaning: "Fixed" }));
  });

  it("rejects a PATCH without a valid id", async () => {
    const res = await PATCH(patchReq({ transliteration: "Aflaak" }));
    expect(res.status).toBe(400);
    expect(mocks.updateLisanWordById).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/lisan-words (by id)", () => {
  it("deletes a word by id", async () => {
    mocks.deleteLisanWordById.mockResolvedValue({ status: "deleted", count: 8 });
    const res = await DELETE(req("http://localhost/api/admin/lisan-words?id=5", { method: "DELETE" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "deleted", count: 8 });
    expect(mocks.deleteLisanWordById).toHaveBeenCalledWith(5);
  });

  it("rejects a DELETE without a valid id", async () => {
    const res = await DELETE(req("http://localhost/api/admin/lisan-words", { method: "DELETE" }));
    expect(res.status).toBe(400);
    expect(mocks.deleteLisanWordById).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/lisan-words?list=1 (browse)", () => {
  it("returns a page of rows", async () => {
    mocks.listLisanWordsPage.mockResolvedValue({
      rows: [{ id: 1, transliteration: "Aab", lisan: "آب", meaning: "Water", example: null }],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    const res = await GET(req("http://localhost/api/admin/lisan-words?list=1&q=aab&field=word"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ total: 1, rows: [{ transliteration: "Aab" }] });
    expect(mocks.listLisanWordsPage).toHaveBeenCalledWith(expect.objectContaining({ q: "aab", field: "word" }));
  });

  it("returns 200 (not 201) when an existing word is updated", async () => {
    mocks.addLisanWord.mockResolvedValue({ status: "updated", entry: { transliteration: "Aflaak" }, count: 42 });
    const res = await PUT(putReq({ transliteration: "Aflaak", lisan: "افلاك", meaning: "x" }));
    expect(res.status).toBe(200);
  });

  it("rejects an empty word (no transliteration and no lisan) without calling the DB", async () => {
    const res = await PUT(putReq({ transliteration: "  ", lisan: "", meaning: "nothing" }));
    expect(res.status).toBe(422);
    expect(mocks.addLisanWord).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/lisan-words?format=csv (export)", () => {
  it("streams the dictionary as a re-importable CSV with the right headers", async () => {
    mocks.listAllLisanWords.mockResolvedValue([
      { transliteration: "Aab", lisan: "آب", meaning: "Water", example: null },
      { transliteration: "Comma, word", lisan: "x", meaning: 'has "quote"', example: "line1\nline2" },
    ]);
    const res = await GET(req("http://localhost/api/admin/lisan-words?format=csv"));
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("lisan-dictionary.csv");
    const text = await res.text();
    expect(text.split("\n")[0]).toBe("transliteration,lisan,meaning,example");
    expect(text).toContain("Aab,آب,Water,");
    // Cells with comma / quote / newline are quoted + internal quotes doubled.
    expect(text).toContain('"Comma, word",x,"has ""quote""","line1\nline2"');
  });

  it("plain GET still returns the count (no csv)", async () => {
    mocks.countLisanWords.mockResolvedValue(7);
    const res = await GET(req("http://localhost/api/admin/lisan-words"));
    expect(await res.json()).toEqual({ count: 7 });
    expect(mocks.listAllLisanWords).not.toHaveBeenCalled();
  });
});
