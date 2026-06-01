-- Enhancement round 2: department descriptions, escalation department tracking,
-- conversation quality scoring, and cron job log table.

-- A. Department description (Enhancement 1)
alter table public.departments add column if not exists description text;

-- B. Escalation department tracking (Enhancement 1)
alter table public.conversation_sessions
  add column if not exists escalation_department_id uuid references public.departments(id);

-- C. Conversation quality scoring (Enhancement 5)
alter table public.conversation_sessions
  add column if not exists quality_score text
    check (quality_score in ('good', 'poor')),
  add column if not exists quality_reason text,
  add column if not exists quality_analyzed_at timestamptz,
  add column if not exists quality_message_count int not null default 0;

-- D. Cron job log table (Enhancement 6)
create table if not exists public.cron_job_logs (
  id uuid primary key default gen_random_uuid(),
  job_key text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'success', 'failure')),
  metadata jsonb not null default '{}',
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.cron_job_logs enable row level security;

create index if not exists cron_job_logs_job_key_idx
  on public.cron_job_logs (job_key);
create index if not exists cron_job_logs_started_at_idx
  on public.cron_job_logs (started_at desc);

-- E. Seed department descriptions from departmentRules in prompts.ts
update public.departments set description = 'Track utaro requests, hotel blocks, room counts, arrival/departure dependencies, form links, confirmation timing, negotiated rates, and guest communication.' where name = 'Accommodation';
update public.departments set description = 'Track audio/video setup, waaz relay, screens, speakers, microphones, streaming, recording, power needs, testing windows, and coordination with site/electrical.' where name = 'AVR';
update public.departments set description = 'Track announcements, relay-site content, FAQs, guides, public/private publishing, review approvals, helpdesk scripts, and messaging to jamaats or mumineen.' where name = 'Communication';
update public.departments set description = 'Track announcements, relay-site content, FAQs, guides, public/private publishing, review approvals, helpdesk scripts, and messaging to jamaats or mumineen.' where name = 'PR';
update public.departments set description = 'Track budgets, quotes, purchase approvals, vendor commitments, payment follow-ups, booth/table needs, receipts, and procurement dependencies.' where name = 'Finance & Procurement';
update public.departments set description = 'Track inspections, permits, egress routes, tent/building occupancy, extinguishers, safety staffing, compliance approvals, and site hazards.' where name = 'Fire Safety';
update public.departments set description = 'Track crowd routes, entrances/exits, capacity, queueing, seating movement, checkpoints, signage dependencies, and volunteer placement.' where name = 'Flow Management';
update public.departments set description = 'Track volunteer recruitment, staffing gaps, schedules, role assignments, onboarding, training, credential needs, and availability confirmations.' where name = 'HR';
update public.departments set description = 'Track WhatsApp agent/helpdesk, dashboard, login/database bugs, automations, website crawler, access control, data integrations, phone-number permissions, manual handoff, analytics, and deployment/repo work.' where name = 'IT';
update public.departments set description = 'Track WhatsApp agent/helpdesk, dashboard, login/database bugs, automations, website crawler, access control, data integrations, phone-number permissions, manual handoff, analytics, and deployment/repo work.' where name = 'ITS';
update public.departments set description = 'Track pending callbacks, unanswered requests, owner confirmations, escalations, reminders, and closure status.' where name = 'Follow-up';
update public.departments set description = 'Track food counts, jaman timing, seating/rahat/chair blocks, partitions, serving flow, vendor/kitchen readiness, dietary needs, and coordination with site/sabeel.' where name = 'Mawaid';
update public.departments set description = 'Track medical staffing, supplies, first-aid stations, emergency routes, patient-flow concerns, equipment, and shift coverage.' where name = 'Medical';
update public.departments set description = 'Track welcome desk setup, registration/check-in, guest guidance, information desk staffing, forms, badge/material handouts, and common attendee questions.' where name = 'Mumineen Reception';
update public.departments set description = 'Track cleaning, venue readiness, setup/teardown, supplies, waste flow, room readiness, and dependencies on site/mawaid/flow.' where name = 'Nazafat/Venue Preparation';
update public.departments set description = 'Track form readiness, payment/confirmation flow, data exports, support questions, reconciliation, and access issues.' where name = 'Online Niyaz Araz';
update public.departments set description = 'Track photo/video coverage plans, photographer assignments, access permissions, shot lists, delivery timelines, and coordination with PR/communications.' where name = 'Photography';
update public.departments set description = 'Track cross-team milestones, status reporting, PM meetings, dashboards, open blockers, ownerless tasks, escalation items, and daily updates.' where name = 'Project Management';
update public.departments set description = 'Track budgets, quotes, purchase approvals, vendor commitments, payment follow-ups, booth/table needs, receipts, and procurement dependencies.' where name = 'Qardan Hasana/Najwa Shukr';
update public.departments set description = 'Track seating/chair blocks, accessibility support, volunteer coverage, elderly/special-needs assistance, queue support, and coordination with mawaid/site/flow.' where name = 'Rahat Support';
update public.departments set description = 'Track sabeel location, snacks/tea/milk schedule, water coolers, hose bibs/water sources, refilling logistics, supplies, volunteer coverage, and site dependencies.' where name = 'Sabeel';
update public.departments set description = 'Track scanner/device readiness, access lists, check-in lanes, badge/QR workflows, staffing, troubleshooting, and data sync issues.' where name = 'Scanning';
update public.departments set description = 'Track guard assignments, access control, entry/exit rules, incident response, restricted areas, crowd safety, and coordination with flow/fire safety.' where name = 'Security';
update public.departments set description = 'Track HVAC, generators, electrical surveys/site plans, tent/seating capacity, water sources, sabeel placement, partitions, vendor calls, rentals, permits, inspections, map/site-layout updates, and dependencies with AV/mawaid/flow.' where name = 'Site/Construction';
update public.departments set description = 'Track decor/signage requirements, wayfinding signs, print/design approvals, placement maps, install timing, and dependencies from flow/site/communications.' where name = 'Tazyeen & Signages';
update public.departments set description = 'Track coordination requests, committee decisions, policy constraints, escalation items, and cross-functional dependencies.' where name = 'TNC';
update public.departments set description = 'Track program/session readiness, participant needs, materials, room/setup requirements, volunteer support, and schedule changes.' where name = 'Istibsaar';
update public.departments set description = 'Track hifz program scheduling, participants, instructors, rooms, materials, and coordination needs.' where name = 'Hifz';
update public.departments set description = 'Track translation staffing, language needs, scripts/content, AV coordination, distribution channels, and review approvals.' where name = 'Translations';
update public.departments set description = 'Track shuttles, drivers, vehicles, pickup/dropoff zones, ride-share guidance, airport/hotel routes, schedules, and communication to mumineen.' where name = 'Transport';
update public.departments set description = 'Track waaz relay/talaqqi logistics, seating assumptions, timing, access, AV/site dependencies, and attendee-flow questions.' where name = 'Waaz Talaqqi';
update public.departments set description = 'Track zakereen schedules, assignments, room/stage needs, transport/accommodation dependencies, and content/program readiness.' where name = 'Zakereen';
update public.departments set description = 'Track karamat planning, materials, staffing, distribution, schedule, and coordination dependencies.' where name = 'Karamat';
