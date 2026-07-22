import { getSupabaseAdmin } from "@/lib/supabase/server";
import { PRIMARY_LABEL, getPrimaryAccount, type WhatsAppAccount } from "@/lib/whatsapp/accounts";

// Admin annotations layered on top of the Meta templates: a friendly display name and an
// on-our-side "active" flag. Meta owns the templates; this table only decorates them so the Send
// Templates console can show readable names and hide retired templates from its pickers.
//
// Templates are WABA-scoped, so annotations are keyed by (WABA, template name). Rows with a NULL
// waba_id are legacy/primary-account annotations (created before multi-account support).

export type TemplateSetting = { friendlyName: string | null; isActive: boolean };

type SettingsRow = {
  template_name: string;
  friendly_name: string | null;
  is_active: boolean;
  waba_id: string | null;
};

// True when a stored row's WABA belongs to the given account. Primary also owns legacy NULL rows.
function rowBelongsToAccount(rowWabaId: string | null, account: WhatsAppAccount): boolean {
  if (account.label === PRIMARY_LABEL) {
    return rowWabaId == null || rowWabaId === account.wabaId;
  }
  return rowWabaId != null && rowWabaId === account.wabaId;
}

// The waba_id value to persist for an account: NULL for the primary (preserves legacy rows),
// the concrete WABA id otherwise.
function storedWabaId(account: WhatsAppAccount): string | null {
  return account.label === PRIMARY_LABEL ? null : account.wabaId ?? null;
}

// All template settings for the given account's WABA, keyed by Meta template name (unique within a
// WABA). Defaults to the primary account. Templates without a row default to
// { friendlyName: null, isActive: true } at the merge site.
export async function getTemplateSettings(
  account: WhatsAppAccount = getPrimaryAccount(),
): Promise<Map<string, TemplateSetting>> {
  const { data } = await getSupabaseAdmin()
    .from("whatsapp_template_settings")
    .select("template_name, friendly_name, is_active, waba_id");
  const map = new Map<string, TemplateSetting>();
  for (const r of (data ?? []) as SettingsRow[]) {
    if (rowBelongsToAccount(r.waba_id, account)) {
      map.set(r.template_name, { friendlyName: r.friendly_name, isActive: r.is_active });
    }
  }
  return map;
}

// Upsert a single template's settings for an account's WABA. Only the provided fields are written,
// so a friendly-name edit doesn't clobber the active flag (and vice versa). Defaults to the primary
// account. Implemented as a scoped read-modify-write because the (WABA, name) uniqueness is enforced
// by a coalesce() index that can't be a Postgres ON CONFLICT target.
export async function upsertTemplateSetting(
  account: WhatsAppAccount = getPrimaryAccount(),
  templateName: string,
  patch: { friendlyName?: string | null; isActive?: boolean },
): Promise<TemplateSetting> {
  const wabaId = storedWabaId(account);
  const db = getSupabaseAdmin();

  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.friendlyName !== undefined) fields.friendly_name = patch.friendlyName;
  if (patch.isActive !== undefined) fields.is_active = patch.isActive;

  let lookup = db
    .from("whatsapp_template_settings")
    .select("template_name")
    .eq("template_name", templateName);
  lookup = wabaId == null ? lookup.is("waba_id", null) : lookup.eq("waba_id", wabaId);
  const existing = await lookup.maybeSingle();

  if (existing.data) {
    let update = db
      .from("whatsapp_template_settings")
      .update(fields)
      .eq("template_name", templateName);
    update = wabaId == null ? update.is("waba_id", null) : update.eq("waba_id", wabaId);
    const { data, error } = await update.select("friendly_name, is_active").single();
    if (error) throw new Error(error.message);
    const saved = data as { friendly_name: string | null; is_active: boolean };
    return { friendlyName: saved.friendly_name, isActive: saved.is_active };
  }

  const { data, error } = await db
    .from("whatsapp_template_settings")
    .insert({ template_name: templateName, waba_id: wabaId, ...fields })
    .select("friendly_name, is_active")
    .single();
  if (error) throw new Error(error.message);
  const saved = data as { friendly_name: string | null; is_active: boolean };
  return { friendlyName: saved.friendly_name, isActive: saved.is_active };
}
