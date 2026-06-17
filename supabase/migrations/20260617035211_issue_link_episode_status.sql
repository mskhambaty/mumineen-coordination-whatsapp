-- Per-link episode lifecycle for issue_escalation_links.
--
-- A conversation_session is one row per person and its escalation_* fields track only the CURRENT
-- episode. Issue links, however, persist across episodes — so when a person's conversation moves on
-- to a new topic, its old issue link went stale. Give each LINK its own status so a conversation can
-- belong to multiple issues, each link resolving independently (and the issue auto-closes when all
-- its links resolve).

alter table public.issue_escalation_links
  add column if not exists status text not null default 'open'
    check (status in ('open', 'resolved')),
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references public.whatsapp_users(id);

create index if not exists issue_escalation_links_status_idx
  on public.issue_escalation_links (issue_id, status);

-- Backfill: a link is resolved if its conversation is currently resolved. (resolved_at is an
-- approximation — the real per-episode time wasn't recorded before this change.) Idempotent.
update public.issue_escalation_links l
set status = 'resolved',
    resolved_at = coalesce(l.resolved_at, now())
from public.conversation_sessions cs
where cs.id = l.conversation_session_id
  and cs.escalation_status = 'resolved'
  and l.status <> 'resolved';
