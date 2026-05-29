create or replace function match_site_content(
  query_embedding vector(1536),
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
as $$
  select id, page_url, page_title, section, content,
    1 - (embedding <=> query_embedding) as similarity
  from site_content
  where is_current = true
    and 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;
