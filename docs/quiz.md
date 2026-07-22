# Ashara Knowledge Quiz

A bilingual multiple-choice quiz delivered over WhatsApp — **a separate, self-contained module that
does not touch the feedback-survey tables or code.** A taker opens one **shared link**, answers one
question at a time with instant right/wrong feedback, and gets a server-graded score + review.
Admins see a leaderboard; participants only ever see their own score.

## Identity: shared link + self-entered ITS

To maximise reach the quiz uses **one shared public link** (the same for everyone), not a
per-recipient token. On the ready screen the taker enters their **ITS number (8 digits) + name**;
that is the identity. An attempt is keyed by **(quiz_key, its_number)** — one attempt per ITS
(idempotent: a returning ITS gets its saved score back, no retake). The server best-effort links the
attempt to a roster mumin by matching `mumineen.its` (for the admin leaderboard only) but does **not**
require roster membership, so guests/mehman can play. **ITS is PII**: stored in the DB (RLS), never
logged, admin-only on the leaderboard; there is intentionally **no public ITS→name lookup**.

A per-recipient **token** path still exists, used only for admin **test links** (preview the live
quiz without entering an ITS).

## Source of truth: questions live in code

The questions are **not** in the database — they live in
[`src/lib/quiz/questions.ts`](../src/lib/quiz/questions.ts) as the bilingual source of truth.

- English is authoritative. Each question's `ld` (Lisan ud Dawat) block holds the **translator's
  text for the question + options** (imported from `ashara quiz with lisan ud dawah.xlsx`), typed in
  the **Kanz al-Marjaan input scheme** — it renders correctly only in that font (the `.lisan` class).
  The UI still falls back to English for the whole question if a `ld` block is `null`.
- The translator did **not** translate the explanations, so `ld.explanation` is empty and the page
  **always shows the English `en.explanation`** (the "lesson" stays English, like the clue/hint).
- Each language block carries a short **`hint`**; the on-page "clue" always shows the English hint.
- **Updating translations** = editing each question's `ld: { question, options[4] }` from the
  translator's sheet (re-run the import or edit by hand). No migration, no DB write.
- Options are authored with the correct one first (`correctIndex: 0`); the public page **shuffles
  option order per session** so the answer is never visually "always first".

## Data model (attempts only)

Service-role-only tables (RLS on, no policies). Base tables in
[`20260625000000_quiz.sql`](../supabase/migrations/20260625000000_quiz.sql); identity columns + the
`quizzes` table in [`20260626000000_quiz_identity.sql`](../supabase/migrations/20260626000000_quiz_identity.sql):

- **`quiz_recipients`** — one row per attempt: `quiz_key`, `mumin_id`/`family_id` (best-effort, by
  ITS), `display_name` (the entered name), `its_number`, `token` (nullable — only test links have
  one), `status`, `score`, `total`, `time_taken_seconds`, `duration_seconds`, `is_test`, timestamps.
  `unique (quiz_key, its_number)` enforces one attempt per ITS (test links have `its_number = null`,
  exempt).
- **`quiz_answers`** — one row per (recipient, question): `question_id`, `chosen_index`, `is_correct`.
  `unique (recipient_id, question_id)`.
- **`quizzes`** — backs the shared link: `quiz_key` (pk), `share_token` (the public path segment),
  `is_open` (close to stop new attempts), `title`. Seeded with `ashara-1448h` →
  `share_token = 'ashara-1448h-quiz'`.

## Grading

[`src/lib/quiz/grading.ts`](../src/lib/quiz/grading.ts) is pure/DB-free: `gradeAnswers()` scores each
pick against `correctIndex`; `total` is the full bank, so a skipped question counts against the score.
Grading runs **server-side on submit** ([`service.ts`](../src/lib/quiz/service.ts) `recordQuizResponse`)
and the stored score is authoritative; the `correctIndex` sent to the client only powers the
low-stakes instant-feedback UX. Submission is **idempotent** — a re-submit returns the saved score.

## Endpoints

The `{token}` path segment is **either** the quiz's `share_token` (the shared link) **or** a
per-recipient test-link token; the route handles both.

- `GET /api/quiz/{token}` — public. Returns the bilingual quiz. For the shared link it sets
  `requires_identity: true` (the page then collects ITS + name); the quiz must be `is_open`. A
  completed test-link recipient gets their saved score instead.
- `POST /api/quiz/{token}` — public. **Shared-link (self-identified)** body:
  `{ its_number (8 digits), name, duration_seconds, time_taken_seconds, answers[] }`. **Test-link**
  body: `{ answers[] }`. Grades server-side, persists, returns `{ score, total, answers[] }`.
  Idempotent (per ITS for the shared link; per recipient for test links).
- `GET /api/admin/quiz/results` — **admin-only** (`canMonitorReligiousChats`): leaderboard (ranked by
  score, then fastest `time_taken_seconds`, then earliest finish; includes admin-only ITS) + summary.
- `GET/POST /api/admin/quiz/share` — **admin-only**: GET the shared link + open state; POST
  `{ is_open }` to open/close the quiz.
- `POST /api/admin/quiz/test-link` — **admin-only**: mints an `is_test` recipient token to preview the
  live quiz end-to-end (no ITS entry).

## Frontend

- Participant: [`src/app/quiz/[token]/page.tsx`](../src/app/quiz/%5Btoken%5D/page.tsx) — a modern
  quiz-app layout in the **Deep Fatemi** palette (forest emerald `#0a3d2e` + gold `#d4af5a` on cream
  `#f6f1e6`): a branded **preloader** (the Chicago Relay Center logo, `public/logo.jpg`, with a
  gentle pulse) → a **ready/start screen** (logo hero, language toggle, and a **time-per-question**
  picker: 60 / 90 / 120s) → the quiz. The question header carries the **logo (top-left)**, the
  title, and a **user-identity avatar** (first-name initial, top-right); a **sliding pill**
  `English ⇄ لسان الدعوة` toggle; a **per-question countdown** (clock, turns coral under 10s); a gold
  dashed progress bar; a white question card; radio-dot option pills with instant right/wrong
  states; and a server-graded **score-ring** result screen (Correct/Missed stat cards + review).
  - **Timer:** each question gets the chosen duration; the countdown pauses once answered and
    **auto-advances to the next question on timeout** (a timed-out question counts as missed).
  - **Clue bulb** sits in the action row beside Continue (as in the reference). The **majlis is not
    printed on the card** — tapping the bulb reveals the majlis **plus a per-question `hint`** (so the
    quiz stays a real test). The bulb turns gold while open and resets each question.
  - Display type is **Fredoka**, body **Plus Jakarta Sans** (loaded via Google Fonts); Lisan renders
    RTL in the self-hosted **Kanz al-Marjaan** font (`public/fonts/KanzalMarjaan.woff2` + `.ttf`),
    which is required for the translator's Kanz-encoded text to display correctly.
  - **Bilingual scope:** the language toggle (shown on the question header, **not** the start screen)
    switches **only** the question, options, and explanation between English and Lisan. Everything
    else — chrome, the majlis, and the **clue/hint** — stays English. Pure presentation; all
    data/grading stays server-side.
  - **Start:** a **slide-to-start** control (drag to begin) gates entry after ITS + name are valid.
    The Continue button and the clue bulb are raised with a drop shadow.
  - **Local preview (dev only):** `/quiz/<anything>?preview=1` loads the bundled questions and grades
    client-side so the page can be walked end-to-end without a database. Records nothing; disabled in
    production (`NODE_ENV`).
  - When the page loads via the shared link (`requires_identity`), the ready screen adds **ITS + Name**
    inputs (Start is gated on a valid 8-digit ITS + name); the entered name drives the avatar + the
    result greeting. Timing (per-question duration + total time taken) is captured and sent on submit.
- Admin: [`src/app/admin/quiz/page.tsx`](../src/app/admin/quiz/page.tsx) — the shared link + copy +
  open/close toggle, "generate test link", and the leaderboard (score, time, admin-only ITS).

## Sending the quiz (broadcast)

Because the link is **identical for everyone**, no per-recipient minting is needed: send the shared
link to any audience via the existing **WhatsApp template console** — a Meta-approved template whose
URL button points at the shared quiz link, blasted to a chosen audience (`resolveAudience` / rules /
selected users) on the same `createBroadcast` engine + drain cron used by surveys. Until a template
is approved, share the link directly. Open/close the quiz from the admin page.

## Still to wire (next steps)

- **Apply the migrations** to the database (the `20260626…_quiz_identity.sql` adds the `quizzes`
  table + ITS/timing columns and seeds the shared link). Until applied, the shared link 404s in a
  real environment; the dev `?preview=1` paths work without a DB.
- **Meta-approved quiz template** with a URL button to the shared link (or reuse the feedback
  template's button pointed at the shared `/quiz/...` link), then send via the template console.
- **Translation review:** the Lisan question/option text is the translator's; the explanations are
  shown in English (not translated). If Lisan explanations are wanted later, fill `ld.explanation`
  and render it for the Lisan view.
