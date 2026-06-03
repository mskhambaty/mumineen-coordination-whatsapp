import { getSupabaseAdmin } from "@/lib/supabase/server";

// Runtime key/value flags stored in app_settings, toggleable from the admin UI without a
// redeploy. Reads are cheap PK lookups; callers fall back to a default when the row is absent.
export async function getSetting(key: string): Promise<string | null> {
  const { data } = await getSupabaseAdmin().from("app_settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

export async function setSetting(key: string, value: string, updatedBy?: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("app_settings")
    .upsert({ key, value, updated_by: updatedBy ?? null, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(`Failed to save setting ${key}: ${error.message}`);
}
