# Ashara Religious Content (Waaz Talaqi)

How the agent stores, manages, and answers questions about the daily Ashara Mubaraka
majalis — Reflections, Tazyeen, Al-Dars, and the Lisan ud Dawat items (Jumla / Kalema /
Unwaan). This content lives in its **own vector store** and is never mixed with logistics
answers.

## 1. Data model

Two tables (see [database.md](./database.md) and `supabase/migrations/`):

- **`religious_topics`** — the editable master blocks. One row per **(year, majlis, category)**.
  Key columns: `title`, `content`, `theme`, `source_url`/`source_label`, and structured metadata
  `year_hijri`, `majlis_number`, `is_ashura`, `category`, `language` (`en`|`lisan`), `status`
  (`indexed`|`pending_translation`|`placeholder`).
- **`religious_content`** — the vector store. `saveReligiousTopic` chunks + embeds a block's
  content into here (page_url `religious://topic/<id>`), denormalizing the majlis metadata onto
  each chunk for provenance + filtering. Searched by the `match_religious_content` RPC.

**Categories** (`ReligiousCategory`) — and what each one IS (this drives routing):
- `reflection` — **PRIMARY**: the English summary of Syedna TUS's actual sermon. Answer sermon-content questions from here first.
- `al_dars` — **deeper**: a deep-dive into a specific point of the sermon.
- `tazyeen` — the masjid **decoration** for that day (own theme, pre-waaz video). **NOT the sermon** — never used to answer sermon-content questions and never related to what was discussed; only on an explicit decoration ask, and offered as a clearly-labelled follow-up.
- `unwaan` / `kalema` / `jumla` — the majlis **topic** / a **word** / a **sentence** from the sermon (Lisan).
- `overview` — a curated **year-level overall-theme** block (`majlis_number` null), for "what was the whole Ashara / last year about". Seeded + editable on `/admin/ashara` (the "Overall theme" card).
- `misc` — the standalone helper blocks.

English categories are indexed directly; Lisan ones (jumla/kalema/unwaan) wait in a translation
queue until an English translation is pasted.

**Theme** (`religious_topics.theme`) — a one-line gist per block (multi-representation indexing).
Auto-generated on save by `generateTheme()` (admin-overridable). Powers compact "overview"
answers and accurate follow-up menus.

## 2. Admin workflow — `/admin/ashara`

The **Ashara Daily Content** dashboard (External → Ashara Daily Content) is the single surface
for entering content. Grid = majlis (rows) × category (columns).

- **Seed a day:** "Seed all 6" creates the 6 category slots for a majlis with metadata + a
  "start here" istibsaar source link. English → `placeholder`, Lisan → `pending_translation`.
  The daily cron `/api/cron/seed-majlis-day` (gated by `ASHARA_START_DATE` / `ASHARA_YEAR`) does
  this automatically each Ashara day; `seedMajlisDay()` is the shared logic.
- **Fill a cell:** click → `ContentBucketEditor`. English: paste the article. Lisan: read the
  original via the **↗ source** link and paste the **English translation**. Saving re-indexes it
  (`status → indexed`) and auto-generates the theme.
- **Translation queue:** the dashboard side-panel lists all `pending_translation` items
  (same-day Jumla/Kalema/Unwaan first); the daily-digest cron also emails them to admins.
- **Generate missing themes:** button → `POST /api/admin/religious-topics/backfill-themes` →
  fills themes for any block that has content but no theme (needs `OPENAI_API_KEY`). Run once
  after first deploy to backfill older (e.g. 1447) blocks.

The old `/admin/knowledge` → Waaz Talaqi tab only shows the standalone `misc` helper blocks; the
per-majlis blocks are managed here.

## 3. Retrieval & answer behavior

All Vaaz / majlis / Iqtibasaat / Tazyeen / Lisan questions go through the
`answer_religious_questions` tool (`src/lib/agent/tools.ts`). Single Lisan **word** lookups use
`get_lisan_word_meaning` instead — exact-`norm` match → **consonant-skeleton** match
(`lisan-words.ts`, `norm_skeleton`; recovers variants like "sadqe" → *Sadaqa*; one hit answers
directly, several → a numbered "did you mean") → trigram fallback. Word meanings never come
from the model's general knowledge. **Short follow-ups** ("Tazyeen", "Al dars", or a bare
number) inherit the majlis+year (or the offered option) from the previous turn — the agent
re-calls the tool with the full reference rather than answering from memory.

**Maintaining the dictionary (DB is the source of truth).** On `/admin/knowledge` the Lisan
uploader supports three operations against `lisan_words` (all `canManageKnowledge`): **Upload &
Replace** (`POST` CSV, full delete+insert — for a bulk reload), **Add a word** (`PUT` JSON, the
day-to-day path — `addLisanWord` computes the same `norm`/`norm_skeleton`/`skeleton_forms`/
`lisan_forms` columns as the bulk import via the shared `prepareLisanRow`, inserts one row, and
**dedupes on `norm`** so re-adding an existing word updates it in place), and **Export CSV**
(`GET ?format=csv`, a re-importable `transliteration,lisan,meaning,example` download for backup /
producing a master copy). A single add is live immediately for `get_lisan_word_meaning`; it
survives until the next full CSV re-upload, so export before replacing if the master isn't current.

**Year resolution (1447 ↔ 1448).** Before retrieving, the tool calls `resolveAsharaYear(query, today)` (`ashara-config.ts`) to anchor on the *event*, not the Hijri calendar: explicit `1447/1448` → that year; "last year" → `LAST_COMPLETED_ASHARA_YEAR` (1447, the indexed one); "this year / today / this Ashara / upcoming" → `ACTIVE_ASHARA_YEAR` (1448, not yet posted); no cue → most-recent-available. If the resolved year has no content, the tool returns `not_available` **with** `available_year` + last year's content, and the agent says "1448H isn't posted yet — here's last year (1447H): …" — it never relabels one year's content as another's. Every answer states the concrete year.

**Category-disciplined retrieval.** The tool checks a **specific majlis** first, then **overview** intent (`isOverviewQuery` → the curated `overview` block + per-majlis theme list), then a **category-aware vector fallback**: a decoration question searches `tazyeen`; everything else searches the sermon sources (`reflection`+`al_dars`+`overview`) so the decoration article can never answer a sermon-content question. `retrieveReligiousContext(query, topK, categories)` post-filters by the denormalized `category` on `religious_content`.

**Can't answer from the reflections → hand off to the team (no improvised ruling).** Decision tree, enforced by `RELIGIOUS_GUIDANCE_RULE`:
1. A real, on-topic match in the reflections → answer + cite the source (above).
2. A genuine Waaz/deen/Iqtibasaat question with **no usable match**, OR a **personal fiqh/fatwa** ("should I fast on 10th Muharram"), OR sectarian/theological debate → the agent calls `move_to_escalation` with category **`religious_followup`** (priority `normal`). It must NOT give a ruling, an Aamil-Saheb redirect, or any `Source:` citation. The system then returns a **fixed reply** (`RELIGIOUS_FOLLOWUP_REPLY` in `run-agent.ts`): *"I answer only from the published Ashara reflections, and I couldn't find this there. I've shared your question with our team — if it relates to the Waaz Mubarak, someone will get back to you, Inshallah."* (subtly scopes follow-up to the Waaz Mubarak).
3. Logistics (hotels, registration, ITS) → `get_site_content_faq`; content-free closings → `[[NO_REPLY]]`. Never escalate those.

This reuses the existing escalation queue (`POST /api/escalations` → `conversation_sessions.escalation_status='pending'` → on-call email/WhatsApp → `/admin/conversations` *Escalations* tab). `religious_followup` is **exempt from the 3-inbound-message gate** (deen questions are often the first message). Because a successful escalation returns its deterministic acknowledgment and skips the second model completion, the irrelevant-citation bug (a fatwa decline getting reflection `Source:` lines stapled on) cannot occur on this path.

**Personal rulings (fatwa) → refuse + FLAG, never answer, never escalate.** A personal fiqh / halal-haram / "do I need to fast" question is *not* a Waaz-content question and is *not* something the event team can answer — it belongs with the Aamil Saheb. The model repeatedly issued its own rulings ("dragon fruit is halal", "fasting on Ashura is sunnah not wajib"), so this is now intercepted **deterministically before any model call**:
- `isPersonalRuling()` (`src/lib/agent/ruling-guard.ts`) — a **keyword fast-path** (ruling-intent tokens: halal/haram, wajib/farz/jaiz, "do I need to", permissibility, "…che ke nai") plus a **cheap classifier** (mirrors `classifyDepartments`, biased to refuse on uncertainty) for paraphrase / Lisan. Keys on *ruling intent*, not topic words, so "what did Maula say about fasting" still answers normally.
- **Logistics rescue (`looksLogistics`).** The classifier is deliberately cautious (*"not answering is fine, a wrong fatwa is not"* → unsure ⇒ refuse), which mis-refused clear logistics phrased like *"I would want my husband to sit in the last row… I will need to sit with him for his personal needs"* (it trips the "need to" pre-filter). A deterministic allow-list **derived from the live `site_content` FAQ topics** (accommodation/utaro, hotels, transport, parking, arrival/venue, timings, wifi, bathrooms, dress code, registration, mawaid, medical/Sehhat, **seating/accessibility/personal-needs**, etc.) short-circuits these to `{ruling:false, via:"logistics"}`. **Ordering:** keyword fast-path **first** (so "is it halal to eat at the mawaid" still refuses) → logistics allow-list → classifier. It only ever returns `false`, so a false-match can at most let a message reach the normal tools — it can never fabricate a ruling. The classifier prompt and pre-filter are unchanged. Grow `LOGISTICS_RE` as new FAQs are added.
- The gate at the top of `runAgent` returns a fixed **refusal** (`RULING_REFUSAL_REPLY` — redirects to the Aamil Saheb, gives no ruling) and writes one row to `religious_ruling_flags`.
- **Flag ≠ escalate.** Flagging is awareness-only: a quiet row, **no on-call ping, no pending status**. Surfaced as a count + recent list on `/admin/escalation` (`GET /api/admin/ruling-flags`). Escalation (loud hand-off) stays reserved for emergencies, frustrated users, and unanswerable Waaz-content (`religious_followup`).

**Output sanitizer (`sanitizeFinalReply`).** A model-independent backstop: the high model has leaked raw tool-call directives + corrupt tokens into replies. Any reply containing `to=functions.…`, harmony markers, or CJK/junk script is stripped; if nothing coherent remains it becomes the safe fallback. The real cure is fixing `OPENAI_MODEL_HIGH` (see [environment.md](./environment.md)).

**Grounding guard — only answer from indexed published content (`run-agent.ts` + `religious-guard.ts`).** The model never narrates a religious refusal/offer and never answers a deen question from general knowledge. Deterministic flow, in order:
1. **Ruling pre-gate** (`isPersonalRuling`) → `RULING_REFUSAL_REPLY` (Aamil Saheb), flagged.
2. **Single-word dictionary pre-route** (`maybeSingleWordQuery` → `lookupLisanWord`): a bare word / "what does X mean" / "X ni maana" (incl. Lisan script) answers straight from `lisan_words` with `Source: Lisan ud Dawat dictionary`; a Latin word not in the dictionary falls through (so a logistics term isn't misrouted).
3. **Did-you-mean numeric pick** (A5) and **offer-last "yes"** (A6) are resolved from history deterministically — never reconstructed by the model.
4. **`answer_religious_questions` returns a `decision`** — `answer` (the model narrates, constrained to the passages + the source row's `year_hijri`), `offer_last` → `THIS_YEAR_OFFER_LAST`, or `not_found` → `NOT_FOUND_REPLY`. Retrieval is **year-scoped** on both surfaces: the vector path filters hits by `year_hijri` (zero 1448 rows, so a 1448 query can't relabel the embedded 1447 rows); the topics path (`getOverviewBlock` / `findMajlisForRef`) now also filters `status='indexed'` (so the 54 un-indexed 1448 rows never leak — `listMajlisThemes` / `availableFacets` already did).
5. **No-tool guard** (A4): if the model returns no tool call, a clearly-social message passes, a positive religious signal (e.g. "who is the 53rd dai") → `NOT_FOUND_REPLY`, and logistics/ambiguous is left unchanged.
6. **Year-label post-check** (`yearLabelMismatch`): a grounded answer that states a Hijri year ≠ the source row's year fails safe to `NOT_FOUND_REPLY`; a null-year guardrail block must state no year.

`NOT_FOUND_REPLY` / `THIS_YEAR_OFFER_LAST` / `RULING_REFUSAL_REPLY` carry **no `Source:` line** — citations attach only to grounded answers whose rows have a `source_url`.

**Query routing** (the tool inspects the query and returns an `answer_style`):

| Intent | Trigger | Returns |
|--------|---------|---------|
| **overview** | "topics of all majalis", "compare", "list/every/overview" | compact per-majlis theme list (`listMajlisThemes`), no full blocks |
| **deep** | "tell me more", "stories", "in detail", "explain" | the full block(s) |
| **brief** (default) | "theme/topic of Majlis N", a plain majlis question | theme + the single best block |

- **Structured majlis lookup** (`findMajlisReflection` / `parseMajlisRef`) resolves an exact
  majlis by metadata (category + majlis_number/is_ashura + year, newest year first) — vector
  search mis-ranks ordinals. Falls back to title-prefix matching for un-backfilled rows.
- **`available_facets`** — which categories actually have indexed content for that majlis, so the
  agent only offers follow-ups that exist.
- **`not_available`** — if the asked majlis/year has no indexed content, the tool says so; the
  agent must NOT fabricate or silently use a different year.

**Answer style** (enforced by `RELIGIOUS_GUIDANCE_RULE` in `src/lib/agent/run-agent.ts`):

- **Length budget:** overview ≤ ~450 chars · brief ≤ ~700 · deep ≤ ~1200. Lead with the
  *bold theme*, then 1–2 tight sentences — never the whole reflection.
- **Progressive disclosure:** end a majlis answer with ONE short follow-up offer drawn from
  `available_facets` (e.g. "Want the deeper _al-Dars_, or the _tazyeen_?"). This deliberately
  overrides the "don't volley" rule for Waaz Talaqi, to drive 3–4 learning exchanges. A bare
  "thanks" still yields the no-reply token.
- **Formatting:** WhatsApp markup (single-asterisk bold, underscore italics for transliterations,
  bullet/numbered lists), reverent tone, honorifics (SA/AS/TUS/RA), no emojis.
- **Citations (at most ONE source line):** finalized server-side by `collectSources` →
  `finalizeSources` (`run-agent.ts`), from the tool-result provenance, never the model's free text.
  Rules: a **single-majlis** answer keeps its precise `Source: <title> — <url>` line; an answer
  spanning **≥ `SOURCE_COLLAPSE_THRESHOLD` (2)** distinct majalis collapses to **one** year-archive
  link — `Source: Ashara <year>H reflections — <reflectionsArchiveUrl(year)>`
  (`https://blogs.jameasaifiyah.edu/reflection-category/{year}h/`); the archive URL is resolved via
  `resolveArchiveUrl(year)` (overview row's `source_url` → derived per-year index → `/ashara-mubaraka/`),
  falling back to the single best per-majlis link if unresolved — never a stack. Grouping is by
  **majlis** (`distinctSourceGroups`), so two facets of the same majlis (reflection + al-Dars) stay
  one precise link. Any model-emitted `Source:` lines are stripped first (no double-cite). **No
  source line at all** on a hand-off / "can't find it" reply (`looksLikeHandoff`) or a terminal
  non-answer decision. blogs.jameasaifiyah.edu links are a permitted exception to the
  "official site only" URL rule.

Prompt changes here must be validated on the Ollama A/B page before shipping
(see [ollama-ab-testing.md](./ollama-ab-testing.md) and AGENTS.md §6).

## 4. Key files

```
src/lib/knowledge/religious-topics.ts    — topics CRUD, parseMajlisRef, findMajlisReflection,
                                           isOverviewQuery/isDeepQuery, listMajlisThemes,
                                           availableFacets, generateTheme, backfillMissingThemes
src/lib/knowledge/index-content.ts       — chunk + embed into religious_content
src/lib/knowledge/ashara-config.ts       — categories, rows, calendar, istibsaarSearchUrl
src/lib/knowledge/seed-majlis.ts         — seedMajlisDay() shared seeding logic
src/lib/agent/tools.ts                   — answer_religious_questions routing
src/lib/agent/run-agent.ts               — RELIGIOUS_GUIDANCE_RULE (answer style)
src/app/admin/ashara/page.tsx            — the Ashara Daily Content dashboard
src/app/api/admin/religious-topics/      — topics API (+ /backfill-themes)
src/app/api/cron/seed-majlis-day/route.ts — daily auto-seed cron
src/components/admin/ContentBucketEditor.tsx — cell editor (content + source + theme)
```

## 5. Daily operations (during Ashara)

1. Open `/admin/ashara`; today's majlis row is highlighted.
2. For that majlis, fill each cell: paste English (Reflections/Tazyeen/Al-Dars), paste the
   English translation for Lisan items (Jumla/Kalema/Unwaan) using the ↗ source link.
3. Save each — it indexes immediately and generates a theme.
4. Clear the translation queue (same-day Jumla/Kalema/Unwaan first).

Env to enable the schedule: `ASHARA_START_DATE` (Majlis 1 date, e.g. `2026-06-16`) and
`ASHARA_YEAR` (e.g. `1448`) — see [environment.md](./environment.md).
