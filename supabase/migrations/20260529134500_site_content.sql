-- Enable pgvector if not already
create extension if not exists vector;

create table site_content (
  id          bigserial primary key,
  page_url    text not null,
  page_title  text,
  section     text,
  content     text not null,
  embedding   vector(1536),
  scraped_at  timestamptz default now(),
  is_current  boolean default true
);

-- Semantic search index
create index on site_content using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

-- For fast "current content only" queries
create index on site_content (is_current, section);
