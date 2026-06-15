import { sendRawEmail } from "@/lib/email/postmark";
import { optionalEnv } from "@/lib/env";
import { isTrivialLookup, normalizeWord } from "@/lib/knowledge/lisan-words";
import { getReligiousMonitorEmails } from "@/lib/knowledge/religious-monitors";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// A member asked the agent for a Lisan ud Dawat word that isn't in the dictionary
// (get_lisan_word_meaning → not_found). We queue it for the team to add and, the FIRST time a
// given word is missed, email the whole religious-monitor team so any of them can add it. When the
// word is added (and it closes an open request) we email the team again — "added". All sends are
// fire-and-forget / best-effort: never throws, never blocks the agent or the admin add flow.

function dictionaryLink(): string {
  const appUrl = optionalEnv("NEXT_PUBLIC_APP_URL");
  return appUrl ? `${appUrl}/admin/religious?tab=dictionary` : "/admin/religious?tab=dictionary";
}

// Recipients = every religious monitor with an email, plus LISAN_ALERT_EMAIL if set (owner stays in
// the loop), deduped. Empty when there are no monitors and no env address → callers skip the send.
async function recipientEmails(): Promise<string[]> {
  const set = new Set<string>();
  for (const m of await getReligiousMonitorEmails()) set.add(m.email);
  const owner = optionalEnv("LISAN_ALERT_EMAIL")?.trim();
  if (owner) set.add(owner);
  return [...set];
}

// Send the same email to each recipient individually (one bad address can't break the rest; teammate
// addresses aren't cross-exposed), mirroring notifyEscalationTeam.
async function fanOut(recipients: string[], subject: string, htmlBody: string, textBody: string): Promise<void> {
  await Promise.all(
    recipients.map((to) => sendRawEmail(to, subject, htmlBody, textBody).catch(() => console.error("lisan alert email failed"))),
  );
}

// "Please add this word" — to the whole team.
async function sendMissingWordEmail(word: string, phone: string | null, timesSeen: number): Promise<void> {
  const recipients = await recipientEmails();
  if (!recipients.length) return;
  const link = dictionaryLink();
  const asker = phone ?? "unknown";
  const subject = `Lisan dictionary: missing word “${word}”`;
  const htmlBody = `
<p>A member asked for a Lisan ud Dawat word that isn't in the dictionary.</p>
<p><strong>Word:</strong> ${word}<br/>
<strong>Asked by:</strong> ${asker}<br/>
<strong>Times asked:</strong> ${timesSeen}</p>
<p>Please add its meaning here: <a href="${link}">${link}</a> (Waaz Talaqqi → Dictionary → Add a word), then reply to the member.</p>
`.trim();
  const textBody = [
    `A member asked for a Lisan ud Dawat word that isn't in the dictionary.`,
    ``,
    `Word: ${word}`,
    `Asked by: ${asker}`,
    `Times asked: ${timesSeen}`,
    ``,
    `Add its meaning at ${link} (Waaz Talaqqi → Dictionary → Add a word), then reply to the member.`,
  ].join("\n");
  await fanOut(recipients, subject, htmlBody, textBody);
}

// "This word has been added" — to the whole team, so nobody double-works it.
async function sendWordAddedEmail(label: string, meaning: string | null, addedBy: string | null): Promise<void> {
  const recipients = await recipientEmails();
  if (!recipients.length) return;
  const link = dictionaryLink();
  const by = addedBy?.trim() ? ` by ${addedBy.trim()}` : "";
  const subject = `Lisan dictionary: “${label}” added`;
  const htmlBody = `
<p>The missing word <strong>${label}</strong> has been added to the dictionary${by}.</p>
${meaning?.trim() ? `<p><strong>Meaning:</strong> ${meaning.trim()}</p>` : ""}
<p>It's no longer in the missing-word queue. <a href="${link}">View the dictionary</a>.</p>
`.trim();
  const textBody = [
    `The missing word "${label}" has been added to the dictionary${by}.`,
    ...(meaning?.trim() ? [``, `Meaning: ${meaning.trim()}`] : []),
    ``,
    `It's no longer in the missing-word queue. ${link}`,
  ].join("\n");
  await fanOut(recipients, subject, htmlBody, textBody);
}

export type MissingWordResult =
  | { status: "skipped" }
  | { status: "logged"; created: boolean };

// Record a missing-word ask. New word → insert + alert the team once; repeat → bump times_seen.
export async function recordMissingLisanWord(word: string, phone: string | null): Promise<MissingWordResult> {
  try {
    const raw = (word ?? "").trim();
    // Don't queue/alert on non-words: "Yes" / "2" / punctuation / 1-char (the same guard the
    // lookup itself uses to refuse trivial replies).
    if (!raw || isTrivialLookup(raw)) return { status: "skipped" };
    const normalized = normalizeWord(raw);
    if (!normalized) return { status: "skipped" };

    const supabase = getSupabaseAdmin();
    const nowIso = new Date().toISOString();

    const { data: existing } = await supabase
      .from("lisan_word_requests")
      .select("id, times_seen")
      .eq("normalized_word", normalized)
      .eq("status", "open")
      .maybeSingle();

    if (existing) {
      // Already queued + already alerted — just aggregate demand. No second email.
      await supabase
        .from("lisan_word_requests")
        .update({
          times_seen: (existing.times_seen ?? 1) + 1,
          last_seen_at: nowIso,
          last_phone_e164: phone,
          updated_at: nowIso,
        })
        .eq("id", existing.id);
      return { status: "logged", created: false };
    }

    const { error } = await supabase
      .from("lisan_word_requests")
      .insert({ word: raw, normalized_word: normalized, last_phone_e164: phone, alerted_at: nowIso });
    if (error) {
      // A racing insert may hit the open-word unique index; treat as already-logged, no alert.
      return { status: "logged", created: false };
    }

    // First sighting of this word → alert the team once (best-effort; the row is already saved).
    try {
      await sendMissingWordEmail(raw, phone, 1);
    } catch {
      console.error("recordMissingLisanWord: alert email failed");
    }
    return { status: "logged", created: true };
  } catch {
    console.error("recordMissingLisanWord failed");
    return { status: "skipped" };
  }
}

// Close out any open request(s) for a word once it's been added to the dictionary, and — if it
// actually closed a waiting request — email the team that it's handled. Returns how many open rows
// were closed. Called from addLisanWord. Never throws.
export async function markWordRequestAdded(
  normalizedWord: string,
  opts?: { label?: string | null; meaning?: string | null; addedBy?: string | null },
): Promise<{ closed: number }> {
  const normalized = (normalizedWord ?? "").trim();
  if (!normalized) return { closed: 0 };
  try {
    const supabase = getSupabaseAdmin();
    const { data: open } = await supabase
      .from("lisan_word_requests")
      .select("id, word")
      .eq("normalized_word", normalized)
      .eq("status", "open");
    const rows = (open ?? []) as { id: string; word: string }[];
    if (!rows.length) return { closed: 0 };

    await supabase
      .from("lisan_word_requests")
      .update({ status: "added", updated_at: new Date().toISOString() })
      .eq("normalized_word", normalized)
      .eq("status", "open");

    // A genuinely-missing word is now handled → tell the team (best-effort).
    try {
      const label = opts?.label?.trim() || rows[0].word;
      await sendWordAddedEmail(label, opts?.meaning ?? null, opts?.addedBy ?? null);
    } catch {
      console.error("markWordRequestAdded: added email failed");
    }
    return { closed: rows.length };
  } catch {
    console.error("markWordRequestAdded failed");
    return { closed: 0 };
  }
}
