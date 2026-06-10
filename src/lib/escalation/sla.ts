import { getSupabaseAdmin } from "@/lib/supabase/server";

type SlaConfig = { urgent: number; normal: number };

const CACHE_TTL_MS = 5 * 60_000;
let cached: { config: SlaConfig; fetchedAt: number } | null = null;

/** Read SLA pickup_minutes for both priorities. Cached 5 min in-memory. */
export async function getSlaConfig(): Promise<SlaConfig> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.config;
  }
  const { data } = await getSupabaseAdmin()
    .from("escalation_sla_config")
    .select("priority, pickup_minutes");

  const rows = (data ?? []) as Array<{ priority: string; pickup_minutes: number }>;
  const config: SlaConfig = { urgent: 15, normal: 60 };
  for (const row of rows) {
    if (row.priority === "urgent") config.urgent = row.pickup_minutes;
    if (row.priority === "normal") config.normal = row.pickup_minutes;
  }
  cached = { config, fetchedAt: Date.now() };
  return config;
}

/** Compute the SLA deadline: escalatedAt + pickup_minutes for the given priority. */
export async function computeSlaDeadline(
  priority: "urgent" | "normal",
  escalatedAt?: Date,
): Promise<Date> {
  const config = await getSlaConfig();
  const minutes = priority === "urgent" ? config.urgent : config.normal;
  const base = escalatedAt ?? new Date();
  return new Date(base.getTime() + minutes * 60_000);
}

/** Drop the in-memory cache (test seam). */
export function __resetSlaCacheForTests(): void {
  cached = null;
}
