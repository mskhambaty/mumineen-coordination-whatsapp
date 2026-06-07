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

// Classify free text to the single best-matching department id, or null when nothing clearly fits
// (caller decides the fallback). Never throws — returns null on any error.
export async function classifyDepartment(text: string): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const depts = await getDepartmentCatalog();
  if (depts.length === 0) return null;

  const catalog = renderCatalog(depts);
  const system =
    "You route a visitor message, issue, or feedback to ONE owning department for a Dawoodi Bohra " +
    "Ashara relay center, using the department names and descriptions provided. Reply with STRICT " +
    'JSON {"index": number}: the catalog number of the single best department, or 0 if none clearly fits.';

  try {
    const client = getAIClient();
    const res = await client.chat.completions.create({
      ...chatParams(AI_MODEL, { maxTokens: 20, temperature: 0 }),
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Departments:\n${catalog}\n\nText:\n${trimmed.slice(0, 1500)}` },
      ],
    });
    const raw = res.choices[0]?.message?.content?.trim() ?? "";
    const match = raw.match(/\{[^}]*\}/);
    const idx = match ? Number((JSON.parse(match[0]) as { index?: unknown }).index) : 0;
    if (Number.isInteger(idx) && idx >= 1 && idx <= depts.length) return depts[idx - 1].id;
    return null;
  } catch (err) {
    console.error("classifyDepartment failed:", err);
    return null;
  }
}

// Test seam — drop the cached catalog so a fresh department list can be stubbed.
export function __resetCatalogCacheForTests() {
  catalogCache = null;
}
