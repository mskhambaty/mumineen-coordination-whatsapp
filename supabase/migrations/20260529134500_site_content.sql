-- Enable pgvector in the extensions schema (not public)
create extension if not exists vector schema extensions;

create table public.site_content (
  id          bigserial primary key,
  page_url    text not null,
  page_title  text,
  section     text,
  content     text not null,
  embedding   extensions.vector(1536),
  scraped_at  timestamptz default now(),
  is_current  boolean default true
);

-- Semantic search index
create index on public.site_content using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 50);

-- For fast "current content only" queries
create index on public.site_content (is_current, section);

alter table public.site_content enable row level security;
