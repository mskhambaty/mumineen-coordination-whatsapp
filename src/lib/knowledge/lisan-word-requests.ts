import { sendRawEmail } from "@/lib/email/postmark";
import { optionalEnv } from "@/lib/env";
import { isTrivialLookup, normalizeWord } from "@/lib/knowledge/lisan-words";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// A member asked the agent for a Lisan ud Dawat word that isn't in the dictionary
// (get_lisan_word_meaning → not_found). We queue it for the team to add and, the FIRST time a
// given word is missed, email a single configured owner so they can add it and reply to the asker.
// Repeat asks for the same word aggregate onto the one open row (times_seen) — no repeat email.
// Fire-and-forget from the agent: never throws, never blocks the user's reply.

// Build + send the "please add this word" alert to the single configured recipient. No-op (no
// throw) when LISAN_ALERT_EMAIL is unset, so the queue still works without email configured.
async function sendMissingWordEmail(word: string, phone: string | null, timesSeen: number): Promise<void> {
  const to = optionalEnv("LISAN_ALERT_EMAIL");
  if (!to) return;

  const appUrl = optionalEnv("NEXT_PUBLIC_APP_URL");
  const addLink = appUrl ? `${appUrl}/admin/knowledge` : "/admin/knowledge";
  const asker = phone ?? "unknown";
  const subject = `Lisan dictionary: missing word “${word}”`;
  const htmlBody = `
<p>A member asked for a Lisan ud Dawat word that isn't in the dictionary.</p>
<p><strong>Word:</strong> ${word}<br/>
<strong>Asked by:</strong> ${asker}<br/>
<strong>Times asked:</strong> ${timesSeen}</p>
<p>Please add its meaning here: <a href="${addLink}">${addLink}</a> (Lisan dictionary → Add a word), then reply to the member.</p>
`.trim();
  const textBody = [
    `A member asked for a Lisan ud Dawat word that isn't in the dictionary.`,
    ``,
    `Word: ${word}`,
    `Asked by: ${asker}`,
    `Times asked: ${timesSeen}`,
    ``,
    `Add its meaning at ${addLink} (Lisan dictionary → Add a word), then reply to the member.`,
  ].join("\n");

  await sendRawEmail(to, subject, htmlBody, textBody);
}

export type MissingWordResult =
  | { status: "skipped" }
  | { status: "logged"; created: boolean };

// Record a missing-word ask. New word → insert + alert the owner once; repeat → bump times_seen.
export async function recordMissingLisanWord(
  word: string,
  phone: string | null,
): Promise<MissingWordResult> {
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

    // First sighting of this word → alert the owner once (best-effort; the row is already saved).
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

// Close out any open request(s) for a word once it's been added to the dictionary, so it leaves
// the team's queue automatically. Called from addLisanWord. Never throws.
export async function markWordRequestAdded(normalizedWord: string): Promise<void> {
  const normalized = (normalizedWord ?? "").trim();
  if (!normalized) return;
  try {
    await getSupabaseAdmin()
      .from("lisan_word_requests")
      .update({ status: "added", updated_at: new Date().toISOString() })
      .eq("normalized_word", normalized)
      .eq("status", "open");
  } catch {
    console.error("markWordRequestAdded failed");
  }
}
