# Targeted Feedback Surveys

A **second, active** feedback system, separate from the passive conversation-mined `feedback_entries`
(see [meal-rsvp-feedback-digest.md](./meal-rsvp-feedback-digest.md)). It composes targeted surveys
from a databank, samples a group of mumineen (fresh-first, never re-asking a question), and collects
responses through a per-recipient **tokenized web form** delivered over WhatsApp.

## Concepts

- **Section databank** (`survey_sections`) — reusable sections, each tied to a feedback `area`
  (`mawaid`, `flow`, `parking_transport`, `audio_video`, `accommodation`, `seating`, `general`).
  `is_general` sections apply to everyone.
- **Question databank** (`survey_questions`) — multiple questions per section; add more as the event
  progresses. Types: `choice` (options stored **best-first**), `scale10`, `scale5`, `yesno`, `text`.
  `negative_values` drive the "why" box; `polarity` flips yes/no & scale scoring.
- **Groups** (`survey_groups`) — named target audiences stored as an audience-filter `RuleGroup`
  (reuses `runFilter` from [audience-filter.ts](../src/lib/whatsapp/audience-filter.ts)). Seeded:
  *All attending*, *Rahat / accessibility*, *Mehmaan — rental car*, *Local Chicago*, *VIP / category*,
  *Accommodation — utaro*, *All Mehman*, *Atfaal (kids under 7)*. The Atfaal group targets the
  **head of family** in households with a child under 7 (via the `has_child_under_7` household
  field) — strictly one message per household, greeting a parent rather than the toddler.
- **Form** (`survey_forms` + `survey_form_questions`) — a composed run: a target + a chosen subset of
  questions (snapshotted for stability). ~5 forms/day → 5 samples. Forms carry free-form **`tags`**
  (editable inline) to tell same-titled forms apart when they target different audiences. The target is EITHER a saved group
  (`group_id`) OR an ad-hoc **custom filter** (`rules`) built in the composer with the same
  react-querybuilder UI as WhatsApp templates ([AudienceFilterBuilder](../src/components/admin/AudienceFilterBuilder.tsx)).
  Custom filters support **NOT** groups, so a broad form can exclude segments already covered by a
  narrower one (e.g. *attending AND NOT (rahat OR wheelchair)*) and avoid re-surveying them.
- **Recipients** (`survey_recipients`) — the sample; each row carries a unique opaque `token`.
- **Exposures** (`survey_question_exposures`) — `unique (mumin_id, question_id)`; enforces
  **once-per-event** no-repeat. Written when a form is committed.
- **Answers** (`survey_answers`) — one row per answered question, scored `sentiment_1_5`, routed to
  the area's department, with the qualitative `reason_text` for negative answers.

## Sampling (`src/lib/surveys/sampling.ts`)

`suggestSample(groupRules, formQuestionIds, size, eventDate, opts)`:
1. `runFilter` → reachable candidates. **Baseline (always, every group AND custom filter):**
   roster-active, has a WhatsApp number, **attending** (not `not_attending`), and **registration
   `submitted`** — we never survey not-attending or unregistered people, regardless of the filter.
2. Exclude anyone **already sampled today** (≤1 sample/day), anyone **exposed to every** question
   in this form, and **chronic non-responders** — sent `NON_RESPONDER_SEND_CAP` (5) real surveys
   without ever responding. Optional: `freeWindowOnly` (only people inside the 24h free window) and
   `excludeAlreadySent` (drop anyone sent any survey this event).
3. Rank **fresh first** (0 prior sends), then fewest sends, then longest-since-last.
Returns the chosen set + a funnel for the admin preview. `suggestQuestionsForSection` rotates the
databank by preferring least-exposed questions.

**Stratified sampling** (`suggestSamplePlan`): a form can carry a `sample_plan` — an array of strata,
each its own audience filter + quota (e.g. `[{Local,105},{Mehman,40}]`). A form's `sample_size`, when
set, acts as an overall **total cap** on the plan, scaling the strata down proportionally (e.g. 145 →
no-op; 100 → strata shrink to sum 100). Preview/Commit sample each
stratum from its pool, dedup across strata, and send one broadcast. Because the ≤1-sample/day rule is
global, sending several plan-forms in sequence **partitions the day's audience** (each person gets one
section/day). Reachable pools dedup to one number per household — so quotas are sized off the deduped
pool (≈ Local 748 / Mehman 490 ÷ 7 daily forms ≈ 107 / 70).

## Sentiment (`src/lib/surveys/sentiment.ts`, pure + unit-tested)

`answerSentiment(question, answer) → 1..5 | null`. Choice = option position (best-first); scale10 =
`ceil(v/2)`; scale5 = v; yes/no = Yes 5 / No 1, inverted for `polarity:'negative'`; text = null.
**"Not applicable" answers** ("Do not apply", "N/A", …, via `isNotApplicable`) score `null` — excluded
from averages, never counted as negative or as a "problem" (no comment box / routing). Section
sentiment = mean of its scored answers.

The **"why?" comment box** is per-question configurable: `collect_comment` toggles it on/off, and
`comment_threshold` (scale questions) sets the rating ≤ which an answer opens it (default scale10 ≤ 6,
scale5 ≤ 3); choice/yes-no use `negative_values`. `isProblemAnswer(type, answer, negative_values, { threshold, collectComment })`
is the single source of truth for both the form UI and the recorder's department routing. Editing a
choice question's **options** (labels + which are "problem" options) is done inline in the Databank.
Questions can be marked **`required`** (mandatory) — the public form shows a `*`, blocks submit until
answered, and `recordSurveyResponse` rejects a submission missing any required answer.

## Delivery (`src/lib/surveys/send.ts`)

`commitAndSendForm(formId, templateCode?)` creates tokens + writes exposures (irreversible), then
dispatches a WhatsApp template via `createBroadcast`. The shared `dispatchSurveyTemplate` resolves the
template (and the WABA/number it lives in) from Meta and binds dynamically: the **dynamic URL-button
suffix = `feedback/s/<token>`** (the template's base URL is the site root), and **every body variable
the template declares** (positional `{{1}}` or named like `mumin_name`) → the name as
**"&lt;First&gt; bhai/bai"** (`honorificName`, by gender). The **template is picked
from a dropdown** in the Forms tab (approved URL-button templates from
`GET /api/admin/whatsapp/templates`) and passed as `template`; `resolveSurveyTemplate` uses the
explicit choice, else falls back to `SURVEY_WA_TEMPLATE` only when `SURVEY_SEND_ENABLED=true`. With
no template selected, the per-recipient links are returned for manual sending.

## Collection (frictionless, token = identity)

- Public page `src/app/feedback/s/[token]/page.tsx` → `GET /api/feedback-survey/[token]` returns the
  form + responder **first name only** (shown as "Submitting as <name> — is this you?"). No login/ITS.
- `POST /api/feedback-survey/[token]` records answers (idempotent; re-submit replaces). The token maps
  to exactly one (mumin, form), so we know who answered which question.

## Admin

`/admin/surveys` (admin/leadership) — tabs: **Compose** (target + sample size + questions → create
form), **Forms** (Test link · Preview sample funnel · Commit & send · Results), **Analytics**,
**Lookup**, **Sends**, **Databank** (add/edit/delete/reorder sections and questions). A **sent** form
locks down — its row shows only **Test to people** and **Results** (the pre-send actions are hidden to
prevent mistakes); the Results panel is collapsible. The **Questions** button opens the form's composed
questions (grouped by section); for a not-yet-sent form you can edit each (text, required, comment box,
options) or remove it — edits apply to that form's snapshot only. Compose has a per-section **Select
all** toggle. **Duplicate** copies a form's questions/title/tags/sample/target into Compose (retired
questions skipped) so you can change the target audience and create a variant quickly. If a form was
committed without a WhatsApp template (status `sampled`, no broadcast), its button becomes **Send
committed** — selecting a template and clicking it dispatches the existing committed batch (no
re-sampling) and marks it sent. So sends only appear under **Sends** once a template is used. APIs under `src/app/api/admin/surveys/**`
(gated by `requirePortalCaller(isAdminOrLeadership)`). Sections and questions both **soft-delete**
(`active=false`) so already-composed forms keep working off their snapshots; deleting a section also
soft-deletes its questions.

**Self-test:** *Test link* on any form mints an `is_test` recipient (no exposures, excluded from
results) and returns a real `/feedback/s/<token>` link. Optionally pass an **ITS** to target a
specific person (the form then greets them by name; response is attributable), and `deliver:true`
to send that link to their WhatsApp (when `SURVEY_SEND_ENABLED`); otherwise copy/forward the link.

**Verify a sample:** *Preview sample* returns the chosen sample with **name + ITS + freshness** and
the admin UI has a **search box** to confirm whether a specific person was selected.

**Individual lookup:** the **Lookup** tab (`GET /api/admin/surveys/responses?q=`/`?its=`) finds a
mumin by name/ITS and shows their full survey history — every answer with its question, form,
section, 1-5 sentiment and reason, plus per-section and overall sentiment, and which forms they
were sent.

**Sample size** is admin-controlled per form and **editable inline** on the Forms row: `suggestSample`
resolves *all* qualifying mumineen, then takes the top N (fresh-first). Set N high to target everyone.

## Analytics (`/admin/surveys` → Analytics tab)

`POST /api/admin/surveys/analytics` ([route](../src/app/api/admin/surveys/analytics/route.ts)) powers a
fully filterable dashboard ([AnalyticsTab](../src/components/admin/surveys/AnalyticsTab.tsx)). Filter by
**which forms/samples**, **area**, **section**, and the responder's **personal attributes** (age,
gender, local/mehman, rahat/accessibility, jamaat, category) — every aggregate recomputes for the
active filter. Shows overview KPIs (respondents, response rate, avg sentiment, comments), a sentiment
distribution, sentiment **by section / area / question**, and **by-attribute breakdowns** (local vs
mehman, gender, age band, rahat vs general, jamaat) so you can see *who* feels *what*.

**AI comment analysis** — `POST /api/admin/surveys/analytics/ai` sends the filtered free-text +
negative-reason comments (text only, no PII) to the LLM (`getAIClient` / `AI_MODEL`) and returns
overall sentiment, recurring **themes**, ranked **areas of improvement** (with severity), and what
worked well. Decision-useful summary on top of the raw comments.

## Key files

```
supabase/migrations/20260616000000_feedback_surveys.sql      — 8 tables + RLS + indexes
supabase/migrations/20260616000100_seed_survey_databank.sql  — sections/questions/groups seed
src/lib/surveys/{sentiment,sampling,send,respond,tokens}.ts  — core logic
src/app/feedback/s/[token]/page.tsx                          — public tokenized form
src/app/api/feedback-survey/[token]/route.ts                 — GET form + POST submit
src/app/admin/surveys/page.tsx                               — admin console
src/app/api/admin/surveys/**                                 — databank/questions/groups/forms/preview/send/results
```

## Not yet (enhancements)

Auto-generate the day's 5 forms; LLM sentiment on free-text; feed section sentiment into the
department digest; reminder re-sends to non-openers.
