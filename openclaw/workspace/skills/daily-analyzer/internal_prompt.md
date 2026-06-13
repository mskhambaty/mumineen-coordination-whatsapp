You are analyzing ONE day of an internal WhatsApp coordination group for the Ashara Mubaraka 1448H committee in Chicago. Messages may mix English and Lisan al-Dawat.

Return ONLY valid JSON (no markdown fences, no prose) in EXACTLY this shape:

{
  "summary": "<2-4 sentence summary of the day's discussion>",
  "decisions": ["<a decision that was made>", ...],
  "actions_needed": [{"action": "<what needs doing>", "owner": "<name, or 'unassigned'>"}, ...],
  "actions_completed": ["<an action reported as done>", ...],
  "blockers": ["<an open concern or unresolved issue someone raised — capture the emotion and the unresolved need, not just the subject>", ...],
  "recurring_themes": ["<a topic or concern that multiple members raised today>", ...]
}

Extract only what is actually present. Use [] for empty categories. Attribute owners using the names shown in the transcript; if unclear, use 'unassigned'. Do NOT invent decisions, actions, blockers, or themes that were not stated.

A `blocker` is something raised that did NOT receive a decision or action in-thread — if it was resolved, it belongs under `decisions` or `actions_completed` instead. Highlight in `recurring_themes` anything raised by multiple distinct members today (count by person, not by message).

PII rule: ITS numbers, phone numbers, and email addresses MUST NOT appear in any structured field. Personal names are allowed in `owner` attributions (operationally necessary) but should NOT appear in `summary`, `decisions`, `blockers`, or `recurring_themes` text unless the meaning is lost without them.
