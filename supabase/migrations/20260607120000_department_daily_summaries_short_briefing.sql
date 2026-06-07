-- Store the short WhatsApp summary alongside the longer email/dashboard briefing.
-- ai_briefing = longer bullet summary (email feedback_html/text + dashboard);
-- ai_briefing_short = one-liner for the WhatsApp daily_department_issue_confirmation template.
alter table public.department_daily_summaries
  add column if not exists ai_briefing_short text;
