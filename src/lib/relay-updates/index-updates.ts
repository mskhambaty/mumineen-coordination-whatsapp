import { indexChunksForPage } from "@/lib/knowledge/index-content";
import { getSupabaseAdmin } from "@/lib/supabase/server";

import { buildUpdateChunks } from "./shared";

export const RELAY_UPDATES_PAGE_URL = "updates://relay";

// Re-embed ALL published updates into site_content (replacing previous chunks) so the
// agent's get_site_content_faq answers from the same news the public page shows.
// Unpublished updates simply drop out on the next call. Deliberately EXCLUDES link/cta:
// the agent may only share the asharamubaraka.net URL (see run-agent.ts), so update links
// must not enter its retrieval context.
export async function reindexRelayUpdates(): Promise<number> {
  const { data, error } = await getSupabaseAdmin()
    .from("relay_updates")
    .select("date, title, body, category")
    .eq("published", true)
    .order("date", { ascending: false });
  if (error) throw new Error(`relay_updates read failed: ${error.message}`);

  return indexChunksForPage(RELAY_UPDATES_PAGE_URL, "Relay Center Updates", buildUpdateChunks(data ?? []));
}

// Best-effort variant for write routes: a vector-store failure must never fail the write
// (the feed is the source of truth; the index catches up on the next successful write).
export async function reindexRelayUpdatesBestEffort(): Promise<void> {
  try {
    await reindexRelayUpdates();
  } catch (err) {
    console.error("relay updates re-index failed:", err);
  }
}
