-- Support separate prompt configs per transcript type (whatsapp vs meeting).

alter table public.department_prompt_config
  add column if not exists transcript_type text not null default 'whatsapp'
  check (transcript_type in ('whatsapp', 'meeting'));

alter table public.department_prompt_config
  drop constraint if exists department_prompt_config_department_id_key;

alter table public.department_prompt_config
  add constraint department_prompt_config_dept_type_unique
  unique (department_id, transcript_type);

create index if not exists department_prompt_config_dept_type_idx
  on public.department_prompt_config (department_id, transcript_type);

-- Track which transcript type each upload was.
alter table public.conversation_uploads
  add column if not exists transcript_type text not null default 'whatsapp'
  check (transcript_type in ('whatsapp', 'meeting'));
