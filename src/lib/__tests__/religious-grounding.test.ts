import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Scripted OpenAI client ──────────────────────────────────────────────────────────────────
let createQueue: unknown[] = [];
const create = vi.fn(async () => createQueue.shift() ?? { choices: [{ message: { content: "(unscripted)" } }] });
const fakeClient = {
  chat: { completions: { create } },
  embeddings: { create: vi.fn(async () => ({ data: [{ embedding: [] }] })) },
};
const toolCall = (query: string) => ({
  choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "answer_religious_questions", arguments: JSON.stringify({ query }) } }] } }],
});
const content = (text: string) => ({ choices: [{ message: { role: "assistant", content: text } }] });

// ─── Fixtures ────────────────────────────────────────────────────────────────────────────────
const ROW_1447_M3 = { title: "Reflections — Ashara 1447H, Majlis 3", content: "Saturn — discipline and jafaakashi.", source_url: "https://blogs.jameasaifiyah.edu/reflection/ashara/1447h/reflections-majlis-3-6/", theme: null, year_hijri: "1447" };
const OVERVIEW_1447 = { title: "Overview — Ashara 1447H", content: "The nine celestial spheres, from al-Falak al-Muheet to Karbala.", source_url: "https://blogs.jameasaifiyah.edu/reflection/ashara/1447h/", theme: null, year_hijri: "1447" };

// ─── Mocks (DB-reading functions only; pure routing helpers stay real) ───────────────────────
const m = vi.hoisted(() => ({
  history: [] as Array<{ direction: string; body: string }>,
  retrieve: vi.fn(),
  findMajlis: vi.fn(),
  overview: vi.fn(),
  themes: vi.fn(),
  recordToolAudit: vi.fn(),
  recordMissingLisanWord: vi.fn(),
  lookupLisanWord: vi.fn(),
  lookupEnglishMeaning: vi.fn(),
}));

vi.mock("@/lib/ai/model", async (orig) => ({ ...(await orig()), getAIClient: () => fakeClient }));
vi.mock("@/lib/agent/prompts", () => ({ SYSTEM_PROMPT: "Test assistant.", loadAgentSystemPrompt: async () => "Test assistant.", loadRuleOverrides: async () => ({}) }));
vi.mock("@/lib/mumineen/sender-profile", () => ({ getSenderProfile: async () => null, formatSenderProfileForPrompt: () => "" }));
vi.mock("@/lib/api/auth", () => ({ resolveCallerFromPhone: async () => undefined }));
vi.mock("@/lib/supabase/server", () => ({
  getRecentMessages: async () => m.history,
  recordToolAudit: async (...a: unknown[]) => m.recordToolAudit(...a),
  getSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ order: async () => ({ data: [] }) }), insert: async () => ({ error: null }) }),
  }),
}));
// Lisan lookups are stubbed so the deterministic pre-routes fire without a DB; ARABIC_RE etc. stay real.
vi.mock("@/lib/knowledge/lisan-words", async (orig) => ({
  ...(await (orig() as Promise<object>)),
  lookupLisanWord: (...a: unknown[]) => m.lookupLisanWord(...a),
  lookupEnglishMeaning: (...a: unknown[]) => m.lookupEnglishMeaning(...a),
}));
vi.mock("@/lib/knowledge/lisan-word-requests", () => ({
  recordMissingLisanWord: async (...a: unknown[]) => m.recordMissingLisanWord(...a),
}));
vi.mock("@/lib/scraper/retrieve-site-context", () => ({
  retrieveReligiousContext: (...a: unknown[]) => m.retrieve(...a),
  retrieveSiteContext: async () => "",
  RELIGIOUS_FALLBACK_MIN_SCORE: 0.35,
}));
vi.mock("@/lib/knowledge/religious-topics", async (orig) => ({
  ...(await orig()),
  findMajlisForRef: (...a: unknown[]) => m.findMajlis(...a),
  getOverviewBlock: (...a: unknown[]) => m.overview(...a),
  listMajlisThemes: (...a: unknown[]) => m.themes(...a),
  availableFacets: async () => [],
}));

import { runAgent } from "@/lib/agent/run-agent";
import { NOT_FOUND_REPLY, THIS_YEAR_OFFER_LAST } from "@/lib/agent/religious-guard";
import { RULING_REFUSAL_REPLY } from "@/lib/agent/ruling-guard";

const visitor = { id: "u1", phone_e164: "+1555", role: "visitor" as const, status: "active" };
const run = (message: string) => runAgent({ user: visitor, phoneE164: "+1555", message });

beforeEach(() => {
  vi.clearAllMocks();
  createQueue = [];
  m.history = [];
  m.retrieve.mockResolvedValue("");
  m.findMajlis.mockImplementation(async (ref: { year?: string | null }) => (ref.year === "1447" ? [ROW_1447_M3] : []));
  m.overview.mockImplementation(async (year: string) => (year === "1447" ? OVERVIEW_1447 : null));
  m.themes.mockResolvedValue([]);
  m.recordToolAudit.mockResolvedValue(undefined);
  m.recordMissingLisanWord.mockResolvedValue(undefined);
  m.lookupLisanWord.mockResolvedValue({ status: "not_found" });
  m.lookupEnglishMeaning.mockResolvedValue({ status: "not_found" });
});

describe("runAgent — religious grounding guard", () => {
  it("T1: general-knowledge religious question (53rd dai) → NOT_FOUND, no model answer, no Source", async () => {
    m.history = [{ direction: "inbound", body: "Who is the 53rd dai?" }];
    createQueue = [content("The 53rd Dai is Syedna Mufaddal Saifuddin TUS.")]; // model tries to free-answer
    const reply = await run("Who is the 53rd dai?");
    expect(reply).toContain(NOT_FOUND_REPLY);
    expect(reply).toContain("istibsaar/oncall"); // can't-answer → suggest the on-call Istibsaar
    expect(reply).not.toContain("Source:");
  });

  it("H1: a factual person lookup with NO religious keyword ('who was Abu Sufyan') is NOT answered from general knowledge", async () => {
    m.history = [{ direction: "inbound", body: "Who was Abu sufyan" }];
    // Model tries to free-answer from general knowledge, with no tool call.
    createQueue = [content("Abu Sufyan is a historical figure from early Islamic history, a leader of the Quraysh.")];
    const reply = await run("Who was Abu sufyan");
    expect(reply).toContain(NOT_FOUND_REPLY);
    expect(reply).not.toMatch(/Quraysh|historical figure|early Islamic history/); // general knowledge must not leak
  });

  it("T3: 'theme of Majlis 3 this year' → NOT_FOUND, never auto-offers 1447 (Fix Y)", async () => {
    m.history = [{ direction: "inbound", body: "What was the theme of Majlis 3 this year?" }];
    createQueue = [toolCall("What was the theme of Majlis 3 this year?")];
    const reply = await run("What was the theme of Majlis 3 this year?");
    expect(reply).toContain(NOT_FOUND_REPLY);
    expect(reply).not.toBe(THIS_YEAR_OFFER_LAST);
    expect(reply).not.toContain("1447"); // never surfaces last year unless explicitly asked
    expect(reply).not.toContain("Source:");
  });

  it("T4: 'yes' after the offer → answers Majlis 3 from 1447, labeled 1447H", async () => {
    m.history = [
      { direction: "inbound", body: "What was the theme of Majlis 3 this year?" },
      { direction: "outbound", body: THIS_YEAR_OFFER_LAST },
      { direction: "inbound", body: "yes" },
    ];
    createQueue = [
      toolCall("What was the theme of Majlis 3 this year? (Ashara 1447H)"),
      content("In *Ashara 1447H*, Majlis 3 was about Saturn — discipline and jafaakashi.\nSource: " + ROW_1447_M3.source_url),
    ];
    const reply = await run("yes");
    expect(reply).toContain("1447H");
    expect(reply).not.toBe(THIS_YEAR_OFFER_LAST);
    expect(reply).not.toBe(NOT_FOUND_REPLY);
  });

  it("T7: personal ruling → ruling refusal (Aamil Saheb), no model, no Source", async () => {
    m.history = [{ direction: "inbound", body: "Is it permissible for me to skip a fast?" }];
    const reply = await run("Is it permissible for me to skip a fast?");
    expect(reply).toBe(RULING_REFUSAL_REPLY);
    expect(reply).not.toContain("Source:");
    expect(create).not.toHaveBeenCalled(); // never reached the model
  });

  it("T10: a waaz question with no indexed match in any year → NOT_FOUND (no escalation/callback)", async () => {
    m.history = [{ direction: "inbound", body: "What did Maula say about sabr?" }];
    m.retrieve.mockResolvedValue(""); // nothing indexed for this query, any year
    createQueue = [toolCall("What did Maula say about sabr?")];
    const reply = await run("What did Maula say about sabr?");
    expect(reply).toContain(NOT_FOUND_REPLY);
    expect(reply).toContain("istibsaar/oncall");
  });

  it("T11: overall theme of 1447 → answered from the indexed 1447 overview, labeled 1447H", async () => {
    m.history = [{ direction: "inbound", body: "What was the overall theme of Ashara 1447?" }];
    createQueue = [
      toolCall("What was the overall theme of Ashara 1447?"),
      content("In *Ashara 1447H*, the overall theme was the nine celestial spheres.\nSource: " + OVERVIEW_1447.source_url),
    ];
    const reply = await run("What was the overall theme of Ashara 1447?");
    expect(reply).toContain("1447H");
    expect(reply).toContain("Source:");
    expect(reply).not.toBe(THIS_YEAR_OFFER_LAST);
    expect(reply).not.toBe(NOT_FOUND_REPLY);
  });

  it("T12: 'majlis themes for 1448' (none indexed) → NOT_FOUND, no 1447 fallback (Fix Y)", async () => {
    m.history = [{ direction: "inbound", body: "List the majlis themes for 1448" }];
    m.themes.mockResolvedValue([]); // status='indexed' filter → zero 1448 themes
    createQueue = [toolCall("List the majlis themes for 1448")];
    const reply = await run("List the majlis themes for 1448");
    expect(reply).toContain(NOT_FOUND_REPLY);
    expect(reply).not.toBe(THIS_YEAR_OFFER_LAST);
    expect(reply).not.toMatch(/Saturn|Jupiter|Majlis \d/); // no placeholder theme content leaked
  });

  it("T8: a greeting still gets a normal (non-refusal) reply", async () => {
    m.history = [{ direction: "inbound", body: "Salaam un Jameel" }];
    createQueue = [content("Salaam un Jameel! How can I help with Ashara Mubaraka?")];
    const reply = await run("Salaam un Jameel");
    expect(reply).toContain("Salaam");
    expect(reply).not.toBe(NOT_FOUND_REPLY);
  });
});

// The deterministic Lisan pre-routes answer BEFORE the model's tool layer, so they must log the
// lookup themselves — otherwise the chat is invisible to the monitor surfaces + undercounts metrics.
describe("runAgent — deterministic Lisan pre-routes are logged", () => {
  it("a bare-word lookup logs a get_lisan_word_meaning tool call (no model call)", async () => {
    m.lookupLisanWord.mockResolvedValue({ status: "ok", matches: [{ transliteration: "Aflaak", lisan: "افلاك", meaning: "Celestial spheres", example: null }] });
    const reply = await run("aflaak");
    expect(reply).toContain("Aflaak");
    expect(m.recordToolAudit).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "get_lisan_word_meaning", phoneE164: "+1555" }),
    );
    expect(create).not.toHaveBeenCalled(); // pre-route short-circuits before the model
  });

  it("a reverse 'lisan word for X' lookup logs with direction to_lisan", async () => {
    m.lookupEnglishMeaning.mockResolvedValue({ status: "ok", matches: [{ transliteration: "Jafakash", lisan: "جفاكش", meaning: "hardworking", example: null }] });
    const reply = await run("what is the lisan word for hardworking");
    expect(reply).toContain("Jafakash");
    expect(m.recordToolAudit).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "get_lisan_word_meaning", arguments: expect.objectContaining({ direction: "to_lisan" }) }),
    );
  });

  it("an explicit miss queues the missing word for the team", async () => {
    m.lookupLisanWord.mockResolvedValue({ status: "not_found" });
    await run("what is the meaning of zzqq");
    expect(m.recordMissingLisanWord).toHaveBeenCalledWith("zzqq", "+1555");
  });
});
