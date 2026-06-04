-- Issue #43: dedicated vector store + editable topic blocks for religious content
-- (Vaaz Talaqi, Iqtibasaat, Lisan ud Dawat word meanings). Kept entirely separate
-- from site_content so the answer_religious_questions tool never cross-contaminates
-- with logistics retrieval (get_site_content_faq). Not department-scoped.

-- pgvector already enabled by the site_content migration; harmless if re-run.
create extension if not exists vector schema extensions;

-- 1. Dedicated vector store, mirroring site_content.
create table if not exists public.religious_content (
  id          bigserial primary key,
  page_url    text not null,
  page_title  text,
  section     text,
  content     text not null,
  embedding   extensions.vector(1536),
  source_type text not null default 'topic_block'
    check (source_type in ('topic_block', 'uploaded_doc')),
  indexed_at  timestamptz default now(),
  is_current  boolean default true
);

-- Semantic search index (matches site_content).
create index if not exists religious_content_embedding_idx
  on public.religious_content using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 50);

-- For fast "current content only" queries.
create index if not exists religious_content_current_section_idx
  on public.religious_content (is_current, section);

alter table public.religious_content enable row level security;

-- 2. Match RPC — identical body to match_site_content, over religious_content.
create or replace function public.match_religious_content(
  query_embedding extensions.vector(1536),
  match_threshold float,
  match_count int
)
returns table (
  id bigint,
  page_url text,
  page_title text,
  section text,
  content text,
  similarity float
)
language sql stable
set search_path = extensions
as $$
  select id, page_url, page_title, section, content,
    1 - (embedding <=> query_embedding) as similarity
  from public.religious_content
  where is_current = true
    and 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- 3. Editable "FAQ by Topic" blocks for religious content (not department-scoped).
-- Each topic's content is vectorized into religious_content under page_url
-- 'religious://topic/<id>'.
create table if not exists public.religious_topics (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  title       text not null,
  content     text not null default '',
  chunk_count integer not null default 0,
  sort_order  integer not null default 0,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

alter table public.religious_topics enable row level security;

create index if not exists religious_topics_sort_order_idx
  on public.religious_topics (sort_order);

-- Seed the three starter topic blocks (idempotent).
insert into public.religious_topics (slug, title, sort_order)
values
  ('vaaz-talaqi-iqtibasaat', 'Vaaz Talaqi / Iqtibasaat help', 1),
  ('lisan-ud-dawat-word-meanings', 'Lisan ud Dawat word meanings', 2),
  ('guardrails-scope-control', 'Guardrails / scope control', 3)
on conflict (slug) do nothing;

-- 4. Tag uploaded knowledge docs by destination store so religious uploads index
-- into religious_content instead of site_content. department_id is already nullable.
alter table public.knowledge_documents
  add column if not exists store text not null default 'logistics'
    check (store in ('logistics', 'religious'));

create index if not exists knowledge_documents_store_idx
  on public.knowledge_documents (store);
