-- Multi-representation indexing: a one-line "theme" per religious topic block.
-- Powers compact overview/list answers ("topics of all majalis") and accurate
-- follow-up menus, so the agent can lead with the theme and stay concise.
alter table public.religious_topics
  add column if not exists theme text;
