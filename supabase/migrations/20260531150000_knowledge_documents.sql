-- Uploaded FAQ/guide documents whose extracted text is vectorized into site_content
-- (page_url = 'knowledge://<doc id>') so the WhatsApp agent grounds on them.
create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments(id) on delete set null,
  uploaded_by uuid references public.whatsapp_users(id) on delete set null,
  title text not null,
  filename text,
  file_type text not null check (file_type in ('csv', 'excel', 'word', 'pdf')),
  status text not null default 'processing' check (status in ('processing', 'indexed', 'failed')),
  chunk_count integer not null default 0,
  error text,
  created_at timestamptz not null default now()
);

alter table public.knowledge_documents enable row level security;

create index if not exists knowledge_documents_department_id_idx on public.knowledge_documents (department_id);
create index if not exists knowledge_documents_created_at_idx on public.knowledge_documents (created_at desc);
