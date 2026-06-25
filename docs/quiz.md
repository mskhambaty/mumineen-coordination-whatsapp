# Ashara Knowledge Quiz

A bilingual, tokenized multiple-choice quiz delivered over WhatsApp (same tap-a-link pattern as
[feedback surveys](./feedback-surveys.md)) — **but a separate, self-contained module that does not
touch the feedback-survey tables or code.** A recipient taps their personal link, answers one
question at a time with instant right/wrong feedback, and gets a server-graded score + review.
Admins see a leaderboard; participants only ever see their own score.

## Source of truth: questions live in code

The questions are **not** in the database — they live in
[`src/lib/quiz/questions.ts`](../src/lib/quiz/questions.ts) as the bilingual source of truth.

- English is authoritative. Each question's `ld` (Lisan ud Dawat) block is `null` until translated;
  the UI falls back to English per-question when `ld` is missing.
- **Feeding translations** = filling each question's `ld: { question, options[4], explanation }`
  from the translator's spreadsheet (`Ashara_1448_Quiz_17.xlsx`). No migration, no DB write.
- Options are authored with the correct one first (`correctIndex: 0`); the public page **shuffles
  option order per session** so the answer is never visually "always first".

## Data model (attempts only)

[`supabase/migrations/20260625000000_quiz.sql`](../supabase/migrations/20260625000000_quiz.sql) — two
service-role-only tables (RLS on, no policies), FKs `ON DELETE SET NULL`:

- **`quiz_recipients`** — one row per person who got a link: `quiz_key`, `mumin_id`/`family_id`,
  `phone_e164`, `display_name` (for the admin leaderboard), unique `token`, `status`
  (sampled→sent→opened→completed), `score`, `total`, `is_test` (excluded from the leaderboard),
  timestamps.
- **`quiz_answers`** — one row per (recipient, question): `question_id` (the code id, e.g. `q1`),
  `chosen_index`, `is_correct`. `unique (recipient_id, question_id)`.

## Grading

[`src/lib/quiz/grading.ts`](../src/lib/quiz/grading.ts) is pure/DB-free: `gradeAnswers()` scores each
pick against `correctIndex`; `total` is the full bank, so a skipped question counts against the score.
Grading runs **server-side on submit** ([`service.ts`](../src/lib/quiz/service.ts) `recordQuizResponse`)
and the stored score is authoritative; the `correctIndex` sent to the client only powers the
low-stakes instant-feedback UX. Submission is **idempotent** — a re-submit returns the saved score.

## Endpoints

- `GET /api/quiz/{token}` — public, token-scoped. Returns the bilingual quiz (+ first name); marks
  the recipient `opened`. A completed recipient gets their saved score instead of the quiz.
- `POST /api/quiz/{token}` — public. Body `{ answers: [{ question_id, chosen_index|null }] }`;
  grades, persists, returns `{ score, total, answers[] }`.
- `GET /api/admin/quiz/results` — **admin-only** (`canMonitorReligiousChats`): leaderboard + summary
  (sent / completed / avg score). Test recipients excluded.
- `POST /api/admin/quiz/test-link` — **admin-only**: mints an `is_test` recipient + returns a link to
  preview the live quiz end-to-end.

## Frontend

- Participant: [`src/app/quiz/[token]/page.tsx`](../src/app/quiz/%5Btoken%5D/page.tsx) — dark theme,
  `English ⇄ لسان الدعوة` toggle, instant feedback, server-graded result + review. Lisan renders RTL
  in the **Kanz al-Marjaan** font (self-hosted at `public/fonts/KanzalMarjaan.woff2` — see that
  folder's README; falls back to a naskh serif until the file is added).
- Admin: [`src/app/admin/quiz/page.tsx`](../src/app/admin/quiz/page.tsx) — leaderboard + "generate
  test link" (the API enforces the gate).

## Still to wire (next steps)

- **WhatsApp broadcast send**: mint a token per mumin and dispatch the approved quiz template
  (reuse the survey template-dispatch mechanism in `src/lib/surveys/send.ts`). Blocked on a
  Meta-approved quiz template (or reuse the feedback template's button pointed at `/quiz/...`).
- **Drop the Kanz al-Marjaan font file** and **feed the Lisan translations** into `questions.ts`.
