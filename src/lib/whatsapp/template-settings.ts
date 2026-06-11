import { getSupabaseAdmin } from "@/lib/supabase/server";

// Admin annotations layered on top of the Meta templates: a friendly display name and an
// on-our-side "active" flag. Meta owns the templates; this table only decorates them so the Send
// Templates console can show readable names and hide retired templates from its pickers.

export type TemplateSetting = { friendlyName: string | null; isActive: boolean };

// All template settings keyed by Meta template name. Templates without a row default to
// { friendlyName: null, isActive: true } at the merge site.
export async function getTemplateSettings(): Promise<Map<string, TemplateSetting>> {
  const { data } = await getSupabaseAdmin()
    .from("whatsapp_template_settings")
    .select("template_name, friendly_name, is_active");
  const map = new Map<string, TemplateSetting>();
  for (const r of (data ?? []) as { template_name: string; friendly_name: string | null; is_active: boolean }[]) {
    map.set(r.template_name, { friendlyName: r.friendly_name, isActive: r.is_active });
  }
  return map;
}

// Upsert a single template's settings. Only the provided fields are written, so a friendly-name
// edit doesn't clobber the active flag (and vice versa).
export async function upsertTemplateSetting(
  templateName: string,
  patch: { friendlyName?: string | null; isActive?: boolean },
): Promise<TemplateSetting> {
  const row: Record<string, unknown> = { template_name: templateName, updated_at: new Date().toISOString() };
  if (patch.friendlyName !== undefined) row.friendly_name = patch.friendlyName;
  if (patch.isActive !== undefined) row.is_active = patch.isActive;

  const { data, error } = await getSupabaseAdmin()
    .from("whatsapp_template_settings")
    .upsert(row, { onConflict: "template_name" })
    .select("friendly_name, is_active")
    .single();
  if (error) throw new Error(error.message);
  const saved = data as { friendly_name: string | null; is_active: boolean };
  return { friendlyName: saved.friendly_name, isActive: saved.is_active };
}
