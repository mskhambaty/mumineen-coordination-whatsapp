import { AI_MODEL, chatParams, getAIClient } from "@/lib/ai/model";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// Robustly associate a free-text issue or piece of feedback with the right department, using the
// LIVE department list + descriptions (not a hardcoded map) so routing stays correct as the
// committee structure evolves. One small, cached LLM call per item.

export type Dept = { id: string; name: string; description: string | null };

const CATALOG_TTL_MS = 5 * 60_000;
let catalogCache: { depts: Dept[]; at: number } | null = null;

// Cached live department list (name + description) — shared by the classifier and the nightly
// conversation-mining job so both route against the same source of truth.
export async function getDepartmentCatalog(): Promise<Dept[]> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.depts;
  const { data } = await getSupabaseAdmin().from("departments").select("id, name, description").order("name");
  const depts = (data ?? []) as Dept[];
  catalogCache = { depts, at: Date.now() };
  return depts;
}

// Render the catalog as a numbered list for an LLM prompt.
export function renderCatalog(depts: Dept[]): string {
  return depts.map((d, i) => `${i + 1}. ${d.name}${d.description ? ` — ${d.description}` : ""}`).join("\n");
}

// Classify free text to ALL clearly-owning departments (usually one; two or three when the text
// genuinely spans areas — e.g. "AC broken and parking chaotic"). Returns [] when nothing fits.
// Never throws.
export async function classifyDepartments(text: string): Promise<string[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const depts = await getDepartmentCatalog();
  if (depts.length === 0) return [];

  const catalog = renderCatalog(depts);
  const system =
    "You route a visitor message, issue, or feedback to its owning department(s) for a Dawoodi Bohra " +
    "Ashara relay center, using the department names and descriptions. Usually ONE department owns it; " +
    "return 2-3 only when the text genuinely concerns multiple distinct areas. Reply with STRICT JSON " +
    '{"indices": number[]}: the catalog numbers of the owning departments (empty array if none clearly fits).';

  try {
    const client = getAIClient();
    const res = await client.chat.completions.create({
      ...chatParams(AI_MODEL, { maxTokens: 40, temperature: 0 }),
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Departments:\n${catalog}\n\nText:\n${trimmed.slice(0, 1500)}` },
      ],
    });
    const raw = res.choices[0]?.message?.content?.trim() ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    const indices = match ? (JSON.parse(match[0]) as { indices?: unknown }).indices : [];
    const ids = (Array.isArray(indices) ? indices : [])
      .map((i) => Number(i))
      .filter((i) => Number.isInteger(i) && i >= 1 && i <= depts.length)
      .map((i) => depts[i - 1].id);
    return [...new Set(ids)];
  } catch (err) {
    console.error("classifyDepartments failed:", err);
    return [];
  }
}

// Single best-matching department id (or null) — for paths that route to ONE owner (e.g. an issue
// ticket). Wraps classifyDepartments and takes the most relevant.
export async function classifyDepartment(text: string): Promise<string | null> {
  const ids = await classifyDepartments(text);
  return ids[0] ?? null;
}

// Test seam — drop the cached catalog so a fresh department list can be stubbed.
export function __resetCatalogCacheForTests() {
  catalogCache = null;
}
