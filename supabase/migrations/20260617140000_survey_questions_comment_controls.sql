-- Per-question control over the "negative comment" box:
--   collect_comment   — master toggle; when false the why-box never appears for this question.
--   comment_threshold — for scale questions, the rating AT OR BELOW which an answer is treated as a
--                       problem (opens the comment box). NULL = use the type default (scale10 ≤ 6,
--                       scale5 ≤ 3). Ignored for choice/yes-no (those use negative_values).
alter table public.survey_questions add column if not exists collect_comment boolean not null default true;
alter table public.survey_questions add column if not exists comment_threshold int;
