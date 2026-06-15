import { getSupabaseAdmin } from "@/lib/supabase/server";

// The religious-monitor team's email addresses — used to fan out Lisan missing-word / word-added
// alerts to everyone who oversees religious chats (mirrors getEscalationMembers in
// src/lib/escalation/notify.ts). Returns [] on any error; never throws.

type MonitorRow = { user: { id: string; display_name: string | null; email: string | null } | null };

export async function getReligiousMonitorEmails(): Promise<{ name: string; email: string }[]> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("religious_monitors")
      .select("user:whatsapp_users(id, display_name, email)");
    if (error || !data) return [];

    const seen = new Set<string>();
    const out: { name: string; email: string }[] = [];
    for (const row of data as unknown as MonitorRow[]) {
      const id = row.user?.id;
      const email = row.user?.email?.trim();
      if (!id || !email || seen.has(id)) continue;
      seen.add(id);
      out.push({ name: row.user?.display_name?.trim() || "Monitor", email });
    }
    return out;
  } catch {
    console.error("getReligiousMonitorEmails failed");
    return [];
  }
}
