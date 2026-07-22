


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "unaccent" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."adjust_broadcast_counters"("p_broadcast_id" "uuid", "p_sent_delta" integer, "p_failed_delta" integer) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  update public.template_broadcasts
  set count_sent = greatest(0, count_sent + p_sent_delta),
      count_failed = greatest(0, count_failed + p_failed_delta)
  where id = p_broadcast_id;
end;
$$;


ALTER FUNCTION "public"."adjust_broadcast_counters"("p_broadcast_id" "uuid", "p_sent_delta" integer, "p_failed_delta" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bump_broadcast_counter"("p_broadcast_id" "uuid", "p_field" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if p_field = 'count_sent' then
    update public.template_broadcasts set count_sent = count_sent + 1 where id = p_broadcast_id;
  elsif p_field = 'count_failed' then
    update public.template_broadcasts set count_failed = count_failed + 1 where id = p_broadcast_id;
  else
    raise exception 'invalid counter field: %', p_field;
  end if;
end;
$$;


ALTER FUNCTION "public"."bump_broadcast_counter"("p_broadcast_id" "uuid", "p_field" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_broadcast_recipients"("p_batch_size" integer, "p_stale_seconds" integer DEFAULT 300) RETURNS TABLE("id" "uuid", "broadcast_id" "uuid", "phone_e164" "text", "body_params" "jsonb", "template_code" "text", "template_language" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  return query
  with claimed as (
    select r.id, r.broadcast_id
    from public.template_broadcast_recipients r
    join public.template_broadcasts b on b.id = r.broadcast_id
    where b.status = 'running'
      and (
        r.send_status = 'queued'
        or (r.send_status = 'sending' and r.claimed_at < now() - make_interval(secs => p_stale_seconds))
      )
    order by r.id
    limit p_batch_size
    for update of r skip locked
  )
  update public.template_broadcast_recipients r
  set send_status = 'sending', claimed_at = now()
  from claimed c
  join public.template_broadcasts b on b.id = c.broadcast_id
  where r.id = c.id
  returning r.id, r.broadcast_id, r.phone_e164, r.body_params, b.template_code, b.template_language;
end;
$$;


ALTER FUNCTION "public"."claim_broadcast_recipients"("p_batch_size" integer, "p_stale_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dashboard_conversation_stats"("p_since" timestamp with time zone) RETURNS json
    LANGUAGE "sql" STABLE
    AS $$
  select json_build_object(
    'session_counts', (
      select json_build_object(
        'total',              count(*),
        'ai',                 count(*) filter (where handling_mode is distinct from 'manual'),
        'manual',             count(*) filter (where handling_mode = 'manual'),
        'escalation_pending', count(*) filter (where escalation_status = 'pending'),
        'quality_good',       count(*) filter (where quality_score = 'good'),
        'quality_poor',       count(*) filter (where quality_score = 'poor'),
        'quality_unscored',   count(*) filter (where quality_score is null
                                                  or quality_score not in ('good','poor'))
      )
      from public.conversation_sessions
      where last_message_at >= p_since
    ),

    'quality_by_day', (
      select coalesce(json_agg(row_to_json(q) order by q.date), '[]'::json)
      from (
        select
          (quality_analyzed_at at time zone 'UTC')::date::text as date,
          count(*) filter (where quality_score = 'good') as good,
          count(*) filter (where quality_score = 'poor') as poor
        from public.conversation_sessions
        where last_message_at >= p_since
          and quality_analyzed_at is not null
          and quality_score in ('good','poor')
        group by 1
      ) q
    ),

    'message_counts', (
      select json_build_object(
        'total',    count(*),
        'inbound',  count(*) filter (where direction = 'inbound'),
        'outbound', count(*) filter (where direction = 'outbound')
      )
      from public.messages
      where created_at >= p_since
    ),

    'messages_by_day', (
      select coalesce(json_agg(row_to_json(d) order by d.date), '[]'::json)
      from (
        select
          (created_at at time zone 'UTC')::date::text as date,
          count(*) filter (where direction = 'inbound')  as inbound,
          count(*) filter (where direction = 'outbound') as outbound
        from public.messages
        where created_at >= p_since
        group by 1
      ) d
    ),

    'user_message_split', (
      select json_build_object(
        'external', count(*) filter (where wu.id is null or wu.role not in ('committee','admin')),
        'internal', count(*) filter (where wu.role in ('committee','admin'))
      )
      from public.messages m
      left join public.whatsapp_users wu on wu.phone_e164 = m.phone_e164
      where m.created_at >= p_since
        and m.direction = 'inbound'
    ),

    'tool_counts', (
      select json_build_object(
        'total',   count(*),
        'blocked', count(*) filter (where not allowed)
      )
      from public.tool_audit_logs
      where created_at >= p_since
    ),

    'top_tools', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json)
      from (
        select tool_name as name, count(*)::int as count
        from public.tool_audit_logs
        where created_at >= p_since
        group by tool_name
        order by count desc
        limit 10
      ) t
    )
  );
$$;


ALTER FUNCTION "public"."dashboard_conversation_stats"("p_since" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."escalation_status_from_stage"("stage" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case
    when stage = 'resolved' then 'resolved'
    when stage is null or stage = 'none' then 'none'
    else 'pending'   -- pending / picked_up / waiting_on_department
  end;
$$;


ALTER FUNCTION "public"."escalation_status_from_stage"("stage" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_mumineen_import"("p_its" "text"[], "p_hof" "text"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- Mark heads (a person whose ITS equals their family's HOF ITS). Only touch changed rows.
  update public.mumineen
    set is_head = (its = hof_its), updated_at = now()
    where is_head is distinct from (its = hof_its);

  -- Link families to their head person-row when present.
  update public.families f
    set head_in_roster = true, head_mumin_id = m.id, updated_at = now()
    from public.mumineen m
    where m.its = f.hof_its and m.roster_active
      and (f.head_in_roster is distinct from true or f.head_mumin_id is distinct from m.id);
  update public.families f
    set head_in_roster = false, head_mumin_id = null, updated_at = now()
    where f.head_in_roster is distinct from false
      and not exists (select 1 from public.mumineen m where m.its = f.hof_its and m.roster_active);

  -- Soft-deactivate rows that fell out of the latest roster file.
  update public.mumineen set roster_active = (its = any(p_its)), updated_at = now()
    where roster_active is distinct from (its = any(p_its));
  update public.families set roster_active = (hof_its = any(p_hof)), updated_at = now()
    where roster_active is distinct from (hof_its = any(p_hof));
end;
$$;


ALTER FUNCTION "public"."finalize_mumineen_import"("p_its" "text"[], "p_hof" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_mumineen_import"("p_its" "text"[], "p_hof" "text"[], "p_deactivate_missing" boolean DEFAULT true) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- Mark heads (a person whose ITS equals their family's HOF ITS). Only touch changed rows.
  update public.mumineen
    set is_head = (its = hof_its), updated_at = now()
    where is_head is distinct from (its = hof_its);

  -- Soft-deactivate rows that fell out of the latest roster file. Skipped for additive
  -- imports (p_deactivate_missing = false), where the uploaded file is a new batch that
  -- shares no ITS with existing records, so the existing roster must be preserved.
  if p_deactivate_missing then
    update public.mumineen set roster_active = (its = any(p_its)), updated_at = now()
      where roster_active is distinct from (its = any(p_its));
    update public.families set roster_active = (hof_its = any(p_hof)), updated_at = now()
      where roster_active is distinct from (hof_its = any(p_hof));
  end if;
end;
$$;


ALTER FUNCTION "public"."finalize_mumineen_import"("p_its" "text"[], "p_hof" "text"[], "p_deactivate_missing" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_mumineen_columns"() RETURNS TABLE("column_name" "text", "data_type" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select c.column_name::text, c.data_type::text
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'mumineen'
    and c.is_generated = 'NEVER';
$$;


ALTER FUNCTION "public"."get_mumineen_columns"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_registration_status"("p_phone" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with matched as (
    select m.id as mumin_id, m.its, m.full_name, m.family_id, f.hof_its, f.registration_status
    from public.mumin_phone_links l
    join public.mumineen m on m.id = l.mumin_id
    join public.families f on f.id = m.family_id
    where l.phone_e164 = p_phone and m.roster_active
  )
  select jsonb_build_object(
    'registered', coalesce(bool_or(registration_status = 'submitted'), false),
    'in_roster', count(*) > 0,
    'member_count', count(*),
    'hof_its', (array_agg(hof_its))[1],
    'primary_mumin_its', (array_agg(its))[1],
    'status', (array_agg(registration_status))[1]
  )
  from matched;
$$;


ALTER FUNCTION "public"."get_registration_status"("p_phone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_permissions"("p_phone" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
declare
  u public.whatsapp_users%rowtype;
  dept_roles jsonb;
begin
  select * into u from public.whatsapp_users where phone_e164 = p_phone;
  if not found then return '{"global_role":"unknown"}'::jsonb; end if;

  if u.global_role = 'leadership_admin' then
    return jsonb_build_object(
      'user_id', u.id,
      'display_name', u.display_name,
      'global_role', u.global_role,
      'can_read_all', true,
      'can_write_all', true
    );
  end if;

  select jsonb_agg(jsonb_build_object(
    'department_id', dm.department_id,
    'department_name', d.name,
    'dept_role', dm.dept_role
  )) into dept_roles
  from public.department_members dm
  join public.departments d on d.id = dm.department_id
  where dm.user_id = u.id and dm.is_active = true;

  return jsonb_build_object(
    'user_id', u.id,
    'display_name', u.display_name,
    'global_role', u.global_role,
    'can_read_all', false,
    'can_write_all', false,
    'departments', coalesce(dept_roles, '[]'::jsonb)
  );
end;
$$;


ALTER FUNCTION "public"."get_user_permissions"("p_phone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_permissions_by_id"("p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
declare
  u public.whatsapp_users%rowtype;
  dept_roles jsonb;
  v_is_support boolean;
  v_is_religious_monitor boolean;
begin
  select * into u from public.whatsapp_users where id = p_user_id;
  if not found or coalesce(u.status, 'active') <> 'active' then
    return '{"global_role":"unknown"}'::jsonb;
  end if;

  select exists(
    select 1 from public.escalation_support_members esm where esm.user_id = u.id
  ) into v_is_support;

  select exists(
    select 1 from public.religious_monitors rm where rm.user_id = u.id
  ) into v_is_religious_monitor;

  select jsonb_agg(jsonb_build_object(
    'department_id', dm.department_id,
    'department_name', d.name,
    'dept_role', dm.dept_role
  )) into dept_roles
  from public.department_members dm
  join public.departments d on d.id = dm.department_id
  where dm.user_id = u.id and dm.is_active = true;

  if u.role = 'admin' or u.global_role = 'leadership_admin' then
    return jsonb_build_object(
      'user_id', u.id,
      'display_name', u.display_name,
      'role', u.role,
      'global_role', 'leadership_admin',
      'can_read_all', true,
      'can_write_all', true,
      'departments', coalesce(dept_roles, '[]'::jsonb),
      'is_escalation_support', v_is_support,
      'is_religious_monitor', v_is_religious_monitor
    );
  end if;

  return jsonb_build_object(
    'user_id', u.id,
    'display_name', u.display_name,
    'role', u.role,
    'global_role', coalesce(u.global_role, 'member'),
    'can_read_all', false,
    'can_write_all', false,
    'departments', coalesce(dept_roles, '[]'::jsonb),
    'is_escalation_support', v_is_support,
    'is_religious_monitor', v_is_religious_monitor
  );
end;
$$;


ALTER FUNCTION "public"."get_user_permissions_by_id"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lisan_script_norm"("s" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  select trim(regexp_replace(
    regexp_replace(
      translate(
        regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
          coalesce(s, ''),
          'چ', 'حح', 'g'), 'پ', 'ثث', 'g'), 'گ', 'كك', 'g'), 'ٹ', 'ضض', 'g'),
          'ڈ', 'دد', 'g'), 'ڑ', 'رر', 'g'), 'ژ', 'زز', 'g'),
        'کیۍێےہھۀ', 'كييييههه'),
      '[ً-ٰـ‌‍]', '', 'g'),
    '\s+', ' ', 'g'));
$$;


ALTER FUNCTION "public"."lisan_script_norm"("s" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_lisan_by_meaning"("query_text" "text", "match_count" integer) RETURNS TABLE("id" bigint, "transliteration" "text", "lisan" "text", "meaning" "text", "example" "text", "similarity" real)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'extensions', 'public'
    AS $$
  select id, transliteration, lisan, meaning, example,
    word_similarity(query_text, meaning) as similarity
  from public.lisan_words
  where query_text <% meaning
  order by word_similarity(query_text, meaning) desc, length(meaning) asc
  limit match_count;
$$;


ALTER FUNCTION "public"."match_lisan_by_meaning"("query_text" "text", "match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_lisan_words"("query_norm" "text", "match_count" integer) RETURNS TABLE("id" bigint, "transliteration" "text", "lisan" "text", "meaning" "text", "example" "text", "similarity" real)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'extensions', 'public'
    AS $$
  select id, transliteration, lisan, meaning, example,
    similarity(norm, query_norm) as similarity
  from public.lisan_words
  where norm % query_norm
  order by similarity(norm, query_norm) desc, length(norm) asc
  limit match_count;
$$;


ALTER FUNCTION "public"."match_lisan_words"("query_norm" "text", "match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_religious_content"("query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer) RETURNS TABLE("id" bigint, "page_url" "text", "page_title" "text", "section" "text", "content" "text", "source_url" "text", "source_label" "text", "year_hijri" "text", "majlis_number" integer, "category" "text", "similarity" double precision)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'extensions'
    AS $$
  select id, page_url, page_title, section, content, source_url, source_label,
    year_hijri, majlis_number, category,
    1 - (embedding <=> query_embedding) as similarity
  from public.religious_content
  where is_current = true
    and 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;


ALTER FUNCTION "public"."match_religious_content"("query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_site_content"("query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer) RETURNS TABLE("id" bigint, "page_url" "text", "page_title" "text", "section" "text", "content" "text", "similarity" double precision)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'extensions'
    AS $$
  select id, page_url, page_title, section, content,
    1 - (embedding <=> query_embedding) as similarity
  from public.site_content
  where is_current = true
    and 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;


ALTER FUNCTION "public"."match_site_content"("query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."niyaz_event_breakdown"("p_instance_id" "uuid") RETURNS TABLE("grp" "text", "eligible" bigint, "yes" bigint, "no" bigint, "yes_adults" bigint, "yes_kids" bigint, "no_adults" bigint, "no_kids" bigint, "responded" bigint, "not_responded" bigint)
    LANGUAGE "sql" STABLE
    AS $$
  with eligible as (
    select
      m.id,
      m.is_adult,
      case when coalesce(m.local_mehman, '') = 'Mehman' then 'mehman' else 'local' end as grp
    from public.mumineen m
    join public.families f on f.id = m.family_id
    where m.roster_active = true
      and m.not_attending = false
      and f.roster_active = true
      and (coalesce(m.local_mehman, '') <> 'Mehman' or f.registration_status = 'submitted')
  ),
  member_rows as (
    select
      e.grp,
      e.is_adult,
      r.attending,
      coalesce(r.source in ('whatsapp', 'admin'), false) as responded
    from eligible e
    left join public.niyaz_rsvp r
      on r.mumin_id = e.id and r.registration_instance_id = p_instance_id
  ),
  member_agg as (
    select
      grp,
      count(*)                                                                        as eligible,
      count(*) filter (where responded and attending)                                 as yes,
      count(*) filter (where responded and not attending)                             as no,
      count(*) filter (where responded and attending and coalesce(is_adult, true))    as yes_adults,
      count(*) filter (where responded and attending and is_adult = false)            as yes_kids,
      count(*) filter (where responded and not attending and coalesce(is_adult, true)) as no_adults,
      count(*) filter (where responded and not attending and is_adult = false)        as no_kids,
      count(*) filter (where responded)                                               as responded,
      count(*) filter (where not responded)                                           as not_responded
    from member_rows
    group by grp
  ),
  guest_agg as (
    select
      'guest'::text                                                                    as grp,
      0::bigint                                                                        as eligible,
      count(*) filter (where r.attending)                                              as yes,
      0::bigint                                                                        as no,
      count(*) filter (where r.attending and coalesce(m.is_adult, true))               as yes_adults,
      count(*) filter (where r.attending and m.is_adult = false)                       as yes_kids,
      0::bigint                                                                        as no_adults,
      0::bigint                                                                        as no_kids,
      count(*) filter (where r.attending)                                              as responded,
      0::bigint                                                                        as not_responded
    from public.niyaz_rsvp r
    join public.mumineen m on m.id = r.mumin_id
    where r.registration_instance_id = p_instance_id
      and m.its like '00000%'
      and r.source in ('whatsapp', 'admin')
    having count(*) filter (where r.attending) > 0
  )
  select * from member_agg
  union all
  select * from guest_agg;
$$;


ALTER FUNCTION "public"."niyaz_event_breakdown"("p_instance_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."niyaz_event_cross_meal"("p_instance_id" "uuid", "p_confirmed_only" boolean) RETURNS TABLE("mumin_id" "uuid", "its" "text", "full_name" "text", "is_adult" boolean, "local_mehman" "text", "hof_its" "text", "whatsapp" "text")
    LANGUAGE "sql" STABLE
    AS $$
  with me as (
    select event_date, meal from public.rsvp_registration_instance where id = p_instance_id
  ),
  sib as (
    select s.id
    from public.rsvp_registration_instance s
    join me on s.event_date = me.event_date
    where s.meal is not null and s.meal is distinct from me.meal
    order by s.id
    limit 1
  )
  select
    m.id                                                                              as mumin_id,
    m.its,
    m.full_name,
    m.is_adult,
    m.local_mehman,
    f.hof_its,
    coalesce(
      m.whatsapp_e164,
      (select pl.phone_e164 from public.mumin_phone_links pl
         where pl.mumin_id = m.id order by pl.is_primary desc limit 1)
    )                                                                                 as whatsapp
  from sib
  join public.niyaz_rsvp here
    on here.registration_instance_id = p_instance_id
    and here.attending = true
    and (not p_confirmed_only or here.source in ('whatsapp', 'admin'))
  join public.niyaz_rsvp there
    on there.registration_instance_id = sib.id
    and there.mumin_id = here.mumin_id
    and there.attending = false
    and (not p_confirmed_only or there.source in ('whatsapp', 'admin'))
  join public.mumineen m on m.id = here.mumin_id
  left join public.families f on f.id = m.family_id
  order by m.id;
$$;


ALTER FUNCTION "public"."niyaz_event_cross_meal"("p_instance_id" "uuid", "p_confirmed_only" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."niyaz_event_family_grid"("p_instance_id" "uuid") RETURNS TABLE("family_id" "uuid", "hof_its" "text", "hof_name" "text", "responded" boolean, "attending" bigint, "guests" bigint, "responded_at" timestamp with time zone, "responded_by" "text")
    LANGUAGE "sql" STABLE
    AS $$
  select
    f.id                                                                              as family_id,
    f.hof_its,
    coalesce(ah.full_name, f.hof_its)                                                 as hof_name,
    coalesce(bool_or(r.source in ('whatsapp', 'admin')), false)                       as responded,
    count(*) filter (where r.attending and m.its not like '00000%')                   as attending,
    count(*) filter (where r.attending and m.its like '00000%')                       as guests,
    max(r.updated_at) filter (where r.source in ('whatsapp', 'admin'))                as responded_at,
    (array_agg(coalesce(r.responded_by_phone, r.recorded_by) order by r.updated_at desc)
       filter (where r.source in ('whatsapp', 'admin')))[1]                           as responded_by
  from public.families f
  left join lateral (
    select m2.full_name
    from public.mumineen m2
    where m2.family_id = f.id and m2.its not like '00000%' and m2.roster_active = true
    order by m2.is_head desc, m2.age desc, m2.its asc
    limit 1
  ) ah on true
  left join public.niyaz_rsvp r
    on r.family_id = f.id and r.registration_instance_id = p_instance_id
  left join public.mumineen m on m.id = r.mumin_id
  where f.roster_active = true
  group by f.id, f.hof_its, ah.full_name
  order by f.id;
$$;


ALTER FUNCTION "public"."niyaz_event_family_grid"("p_instance_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."niyaz_event_individual_grid"("p_instance_id" "uuid") RETURNS TABLE("mumin_id" "uuid", "its" "text", "full_name" "text", "is_adult" boolean, "local_mehman" "text", "hof_its" "text", "whatsapp" "text", "attending" boolean, "source" "text", "responded_by" "text", "updated_at" timestamp with time zone, "responded" boolean)
    LANGUAGE "sql" STABLE
    AS $$
  select
    m.id                                                                              as mumin_id,
    m.its,
    m.full_name,
    m.is_adult,
    m.local_mehman,
    f.hof_its,
    coalesce(
      m.whatsapp_e164,
      (select pl.phone_e164 from public.mumin_phone_links pl
         where pl.mumin_id = m.id order by pl.is_primary desc limit 1)
    )                                                                                 as whatsapp,
    r.attending,
    r.source,
    coalesce(r.responded_by_phone, r.recorded_by)                                     as responded_by,
    r.updated_at,
    coalesce(r.source in ('whatsapp', 'admin'), false)                                as responded
  from public.mumineen m
  join public.families f on f.id = m.family_id
  left join public.niyaz_rsvp r
    on r.mumin_id = m.id and r.registration_instance_id = p_instance_id
  where m.roster_active = true
    and m.not_attending = false
    and f.roster_active = true
    and (coalesce(m.local_mehman, '') <> 'Mehman' or f.registration_status = 'submitted')
  order by m.id;
$$;


ALTER FUNCTION "public"."niyaz_event_individual_grid"("p_instance_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."niyaz_event_tallies_min"() RETURNS TABLE("instance_id" "uuid", "yes_adults" bigint, "yes_kids" bigint, "yes_families" bigint, "thaal_count" numeric, "no_adults" bigint, "no_kids" bigint, "no_families" bigint)
    LANGUAGE "sql"
    AS $$
  select
    i.id as instance_id,
    count(*) filter (where r.attending and coalesce(m.is_adult, true))        as yes_adults,
    count(*) filter (where r.attending and m.is_adult = false)                as yes_kids,
    count(distinct r.family_id) filter (where r.attending)                    as yes_families,
    ceil((count(*) filter (where r.attending))::numeric / 8)                  as thaal_count,
    count(*) filter (where (not r.attending) and coalesce(m.is_adult, true))  as no_adults,
    count(*) filter (where (not r.attending) and m.is_adult = false)          as no_kids,
    count(distinct r.family_id) filter (where not r.attending)                as no_families
  from public.rsvp_registration_instance i
  left join public.niyaz_rsvp r
    on r.registration_instance_id = i.id
    and r.source in ('whatsapp', 'admin')
  left join public.mumineen m on m.id = r.mumin_id
  group by i.id;
$$;


ALTER FUNCTION "public"."niyaz_event_tallies_min"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_whatsapp_undeliverable"("p_phone" "text", "p_error_code" integer, "p_threshold" integer) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
  insert into public.whatsapp_undeliverable
    (phone_e164, fail_count, first_failed_at, last_failed_at, last_error_code, suppressed, suppressed_at)
  values
    (p_phone, 1, now(), now(), p_error_code, (1 >= p_threshold), case when 1 >= p_threshold then now() else null end)
  on conflict (phone_e164) do update set
    fail_count = public.whatsapp_undeliverable.fail_count + 1,
    last_failed_at = now(),
    last_error_code = p_error_code,
    suppressed = public.whatsapp_undeliverable.suppressed
                 or (public.whatsapp_undeliverable.fail_count + 1 >= p_threshold),
    suppressed_at = case
      when public.whatsapp_undeliverable.suppressed then public.whatsapp_undeliverable.suppressed_at
      when public.whatsapp_undeliverable.fail_count + 1 >= p_threshold then now()
      else null
    end;
end;
$$;


ALTER FUNCTION "public"."record_whatsapp_undeliverable"("p_phone" "text", "p_error_code" integer, "p_threshold" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_family_niyaz_rsvp"("p_family_id" "uuid") RETURNS "void"
    LANGUAGE "sql"
    AS $$
  insert into public.niyaz_rsvp (registration_instance_id, mumin_id, family_id, attending, source)
  select i.id, m.id, m.family_id,
    case
      when m.not_attending then false
      when m.arrival_at is null then true
      else ((m.arrival_at at time zone 'America/Chicago')::date <= i.event_date)
    end,
    'registration'
  from public.rsvp_registration_instance i
  cross join public.mumineen m
  where m.family_id = p_family_id
    and m.roster_active = true
    and i.event_date is not null
  on conflict (registration_instance_id, mumin_id) do update
    set attending = excluded.attending,
        source = 'registration',
        updated_at = now()
    where niyaz_rsvp.source in ('default', 'registration', 'roster');
$$;


ALTER FUNCTION "public"."seed_family_niyaz_rsvp"("p_family_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_broadcasts_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_broadcasts_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_department_daily_summaries_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_department_daily_summaries_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_department_prompt_config_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_department_prompt_config_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_issues_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$;


ALTER FUNCTION "public"."set_issues_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_milestones_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_milestones_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_niyaz_event_config_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_niyaz_event_config_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_niyaz_family_headcount_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_niyaz_family_headcount_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_niyaz_rsvp_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_niyaz_rsvp_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_rsvp_registration_instance_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_rsvp_registration_instance_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_rsvp_responses_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_rsvp_responses_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_system_prompts_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_system_prompts_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_tasks_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_tasks_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_unregistered_rsvps_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_unregistered_rsvps_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_whatsapp_template_settings_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_whatsapp_template_settings_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_whatsapp_users_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_whatsapp_users_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."accommodation_host_imports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "uploaded_by" "text",
    "filename" "text",
    "row_count" integer DEFAULT 0 NOT NULL,
    "raw_json" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL
);


ALTER TABLE "public"."accommodation_host_imports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accommodation_hosts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "hof_its" "text" NOT NULL,
    "first_name" "text",
    "middle_name" "text",
    "last_name" "text",
    "poc" "text",
    "status" "text",
    "mobile" "text",
    "address" "text",
    "city" "text",
    "pincode" "text",
    "lat" double precision,
    "lon" double precision,
    "geocoded_at" timestamp with time zone,
    "geocode_source" "text",
    "can_provide_utaro" boolean DEFAULT false NOT NULL,
    "capacity_mehman" integer DEFAULT 0 NOT NULL,
    "bedrooms_mehman" integer,
    "bathrooms_mehman" integer,
    "capacity_family_friends" integer DEFAULT 0 NOT NULL,
    "include_family_friends" boolean DEFAULT false NOT NULL,
    "sahebo_preference" "text",
    "gender_preference" "text",
    "days_after_ashura" integer,
    "pet_type" "text",
    "number_allocated" integer DEFAULT 0 NOT NULL,
    "import_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "enabled_for_suggestions" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."accommodation_hosts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accommodation_matches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "guest_family_id" "uuid" NOT NULL,
    "host_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "guest_member_count" integer DEFAULT 1 NOT NULL,
    "notes" "text",
    "previous_acc_type" "text",
    "previous_utaro_host_name" "text",
    "previous_utaro_host_its" "text",
    "previous_utaro_host_address" "text",
    "confirmed_at" timestamp with time zone,
    "confirmed_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "accommodation_matches_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'rejected'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."accommodation_matches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_settings" (
    "key" "text" NOT NULL,
    "value" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "text"
);


ALTER TABLE "public"."app_settings" OWNER TO "postgres";


COMMENT ON TABLE "public"."app_settings" IS 'App-wide key/value runtime flags toggled from the admin UI (service-role only).';



CREATE TABLE IF NOT EXISTS "public"."broadcast_recipients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "broadcast_id" "uuid" NOT NULL,
    "phone_e164" "text" NOT NULL,
    "mumin_id" "uuid",
    "family_id" "uuid",
    "params" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "skip_reason" "text",
    "wa_message_id" "text",
    "error" "text",
    "attempts" integer DEFAULT 0 NOT NULL,
    "claimed_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "broadcast_recipients_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sending'::"text", 'sent'::"text", 'failed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."broadcast_recipients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."broadcasts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_by" "text",
    "template_name" "text" NOT NULL,
    "template_language" "text" NOT NULL,
    "audience_rules" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "variable_bindings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "total" integer DEFAULT 0 NOT NULL,
    "sent" integer DEFAULT 0 NOT NULL,
    "failed" integer DEFAULT 0 NOT NULL,
    "skipped" integer DEFAULT 0 NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "broadcasts_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'sending'::"text", 'completed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."broadcasts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."committee_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "permission_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."committee_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversation_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "upload_id" "uuid" NOT NULL,
    "department_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "task_id" "uuid",
    "sender_alias" "text",
    "sender_user_id" "uuid",
    "message_text" "text",
    "message_timestamp" timestamp with time zone,
    "ai_summary" "text",
    "confidence" double precision,
    "applied" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "task_title" "text",
    "assigned_to_alias" "text",
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "milestone_id" "uuid",
    "item_type" "text" DEFAULT 'task'::"text",
    "milestone_title" "text",
    "percent_complete" integer,
    "budget" numeric(12,2),
    "notes" "text",
    "description" "text",
    "function_call_id" "uuid",
    "raw_function_event" "jsonb",
    "suggested_changes" "jsonb",
    "suggested_status" "text",
    "due_date" "date",
    "assigned_to_user_id" "uuid",
    "source" "text",
    "temp_milestone_id" "text",
    CONSTRAINT "conversation_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['task_created'::"text", 'task_updated'::"text", 'task_completed'::"text", 'milestone_created'::"text", 'milestone_updated'::"text", 'issue_created'::"text", 'issue_updated'::"text", 'issue_resolved'::"text", 'decision'::"text", 'info'::"text"]))),
    CONSTRAINT "conversation_events_item_type_check" CHECK (("item_type" = ANY (ARRAY['task'::"text", 'issue'::"text", 'milestone'::"text"]))),
    CONSTRAINT "conversation_events_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "conversation_events_suggested_status_check" CHECK ((("suggested_status" IS NULL) OR ("suggested_status" = ANY (ARRAY['open'::"text", 'in_progress'::"text", 'blocked'::"text", 'complete'::"text"]))))
);


ALTER TABLE "public"."conversation_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversation_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone_e164" "text" NOT NULL,
    "user_id" "uuid",
    "current_intent" "text",
    "state" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "last_message_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "handling_mode" "text" DEFAULT 'ai'::"text" NOT NULL,
    "handling_mode_at" timestamp with time zone,
    "handling_mode_by" "uuid",
    "escalation_reason" "text",
    "escalation_priority" "text" DEFAULT 'normal'::"text" NOT NULL,
    "escalation_category" "text",
    "escalated_at" timestamp with time zone,
    "escalation_source" "text",
    "escalation_department_id" "uuid",
    "quality_score" "text",
    "quality_reason" "text",
    "quality_analyzed_at" timestamp with time zone,
    "quality_message_count" integer DEFAULT 0 NOT NULL,
    "escalation_stage" "text" DEFAULT 'none'::"text" NOT NULL,
    "escalation_assigned_to" "uuid",
    "escalation_assigned_at" timestamp with time zone,
    "escalation_sla_deadline" timestamp with time zone,
    "linked_task_id" "uuid",
    "linked_issue_id" "uuid",
    "phone_number_id" "text",
    "escalation_status" "text" GENERATED ALWAYS AS (
CASE
    WHEN ("escalation_stage" = 'resolved'::"text") THEN 'resolved'::"text"
    WHEN (("escalation_stage" IS NULL) OR ("escalation_stage" = 'none'::"text")) THEN 'none'::"text"
    ELSE 'pending'::"text"
END) STORED,
    CONSTRAINT "conversation_sessions_escalation_priority_check" CHECK (("escalation_priority" = ANY (ARRAY['normal'::"text", 'urgent'::"text"]))),
    CONSTRAINT "conversation_sessions_escalation_source_check" CHECK (("escalation_source" = ANY (ARRAY['ai'::"text", 'rule'::"text", 'manual'::"text"]))),
    CONSTRAINT "conversation_sessions_escalation_stage_check" CHECK (("escalation_stage" = ANY (ARRAY['none'::"text", 'pending'::"text", 'picked_up'::"text", 'waiting_on_department'::"text", 'resolved'::"text"]))),
    CONSTRAINT "conversation_sessions_handling_mode_check" CHECK (("handling_mode" = ANY (ARRAY['ai'::"text", 'manual'::"text"]))),
    CONSTRAINT "conversation_sessions_quality_score_check" CHECK (("quality_score" = ANY (ARRAY['good'::"text", 'poor'::"text"])))
);


ALTER TABLE "public"."conversation_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversation_upload_departments" (
    "upload_id" "uuid" NOT NULL,
    "department_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."conversation_upload_departments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversation_uploads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "department_id" "uuid" NOT NULL,
    "uploaded_by" "uuid",
    "filename" "text",
    "group_name" "text",
    "raw_content" "text" NOT NULL,
    "parsed_at" timestamp with time zone,
    "last_message_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "parsed_new_members" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "transcript_type" "text" DEFAULT 'whatsapp'::"text" NOT NULL,
    CONSTRAINT "conversation_uploads_transcript_type_check" CHECK (("transcript_type" = ANY (ARRAY['whatsapp'::"text", 'meeting'::"text"])))
);


ALTER TABLE "public"."conversation_uploads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cron_job_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_key" "text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cron_job_logs_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'success'::"text", 'failure'::"text"])))
);


ALTER TABLE "public"."cron_job_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."department_contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "department_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "role" "text",
    "phone_e164" "text",
    "email" "text",
    "notes" "text",
    "display_order" smallint DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."department_contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."department_daily_summaries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "department_id" "uuid",
    "summary_date" "date" NOT NULL,
    "metrics" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "ai_briefing" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ai_briefing_short" "text"
);


ALTER TABLE "public"."department_daily_summaries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."department_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "department_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "dept_role" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "contact_for_issues" boolean DEFAULT false NOT NULL,
    "daily_feedback_digest" boolean DEFAULT true NOT NULL,
    CONSTRAINT "department_members_dept_role_check" CHECK (("dept_role" = ANY (ARRAY['hod'::"text", 'pm'::"text", 'member'::"text"])))
);


ALTER TABLE "public"."department_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."department_prompt_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "department_id" "uuid" NOT NULL,
    "flexible_prompt" "text" DEFAULT ''::"text" NOT NULL,
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "transcript_type" "text" DEFAULT 'whatsapp'::"text" NOT NULL,
    CONSTRAINT "department_prompt_config_transcript_type_check" CHECK (("transcript_type" = ANY (ARRAY['whatsapp'::"text", 'meeting'::"text"])))
);


ALTER TABLE "public"."department_prompt_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."departments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "description" "text"
);


ALTER TABLE "public"."departments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."escalation_activity_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_session_id" "uuid",
    "task_id" "uuid",
    "phone_e164" "text",
    "action" "text" NOT NULL,
    "actor_user_id" "uuid",
    "actor_label" "text",
    "details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "issue_id" "uuid",
    CONSTRAINT "escalation_activity_log_action_check" CHECK (("action" = ANY (ARRAY['escalated'::"text", 'picked_up'::"text", 'created_task'::"text", 'linked_to_task'::"text", 'unlinked_from_task'::"text", 'resolved'::"text", 'bulk_resolved'::"text", 'reassigned'::"text", 'created_issue'::"text", 'linked_to_issue'::"text", 'unlinked_from_issue'::"text", 'issue_resolved'::"text"])))
);


ALTER TABLE "public"."escalation_activity_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."escalation_sla_config" (
    "priority" "text" NOT NULL,
    "pickup_minutes" integer NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    CONSTRAINT "escalation_sla_config_priority_check" CHECK (("priority" = ANY (ARRAY['urgent'::"text", 'normal'::"text"])))
);


ALTER TABLE "public"."escalation_sla_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."escalation_support_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."escalation_support_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."families" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "hof_its" "text" NOT NULL,
    "roster_active" boolean DEFAULT true NOT NULL,
    "registration_status" "text" DEFAULT 'not_started'::"text" NOT NULL,
    "submitted_at" timestamp with time zone,
    "submitted_by_its" "text",
    "acc_type" "text",
    "hotel_name" "text",
    "hotel_address" "text",
    "utaro_host_name" "text",
    "utaro_host_its" "text",
    "utaro_host_address" "text",
    "utaro_host_whatsapp_e164" "text",
    "utaro_host_email" "text",
    "transport_mode" "text",
    "transport_detail" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "open_to_utaro" boolean DEFAULT false NOT NULL,
    "hotel_lat" double precision,
    "hotel_lon" double precision,
    CONSTRAINT "families_acc_type_check" CHECK (("acc_type" = ANY (ARRAY['hotel'::"text", 'utaro'::"text"]))),
    CONSTRAINT "families_registration_status_check" CHECK (("registration_status" = ANY (ARRAY['not_started'::"text", 'submitted'::"text"]))),
    CONSTRAINT "families_transport_mode_check" CHECK (("transport_mode" = ANY (ARRAY['rideshare'::"text", 'rental'::"text", 'commute_with_utaro'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."families" OWNER TO "postgres";


COMMENT ON COLUMN "public"."families"."open_to_utaro" IS 'Hotel-staying family is open to Utaro if a host becomes available (interest flag only).';



CREATE TABLE IF NOT EXISTS "public"."faq_buckets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "department_id" "uuid" NOT NULL,
    "content" "text" DEFAULT ''::"text" NOT NULL,
    "chunk_count" integer DEFAULT 0 NOT NULL,
    "updated_by" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."faq_buckets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "campaign_id" "uuid",
    "family_id" "uuid",
    "mumin_id" "uuid",
    "phone_e164" "text",
    "rating" integer,
    "comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "feedback_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feedback_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "family_id" "uuid",
    "mumin_id" "uuid",
    "phone_e164" "text",
    "area" "text" NOT NULL,
    "sentiment" "text",
    "rating" integer,
    "comment_text" "text",
    "raw_message" "text",
    "event_date" "date",
    "source" "text" DEFAULT 'whatsapp'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "department_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    CONSTRAINT "feedback_entries_area_check" CHECK (("area" = ANY (ARRAY['mawaid'::"text", 'flow'::"text", 'parking_transport'::"text", 'audio_video'::"text", 'accommodation'::"text", 'seating'::"text", 'general'::"text"]))),
    CONSTRAINT "feedback_entries_rating_check" CHECK ((("rating" IS NULL) OR (("rating" >= 1) AND ("rating" <= 5)))),
    CONSTRAINT "feedback_entries_sentiment_check" CHECK (("sentiment" = ANY (ARRAY['positive'::"text", 'neutral'::"text", 'negative'::"text"]))),
    CONSTRAINT "feedback_entries_source_check" CHECK (("source" = ANY (ARRAY['whatsapp'::"text", 'admin'::"text", 'mined'::"text"])))
);


ALTER TABLE "public"."feedback_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."issue_escalation_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "issue_id" "uuid" NOT NULL,
    "conversation_session_id" "uuid" NOT NULL,
    "linked_by" "uuid",
    "linked_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "resolved_at" timestamp with time zone,
    "resolved_by" "uuid",
    CONSTRAINT "issue_escalation_links_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'resolved'::"text"])))
);


ALTER TABLE "public"."issue_escalation_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."issues" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "issue_number" integer NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "department_id" "uuid",
    "assigned_to" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "issues_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "issues_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'in_progress'::"text", 'resolved'::"text"])))
);


ALTER TABLE "public"."issues" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."issues_issue_number_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."issues_issue_number_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."issues_issue_number_seq" OWNED BY "public"."issues"."issue_number";



CREATE TABLE IF NOT EXISTS "public"."knowledge_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "department_id" "uuid",
    "uploaded_by" "uuid",
    "title" "text" NOT NULL,
    "filename" "text",
    "file_type" "text" NOT NULL,
    "status" "text" DEFAULT 'processing'::"text" NOT NULL,
    "chunk_count" integer DEFAULT 0 NOT NULL,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "store" "text" DEFAULT 'logistics'::"text" NOT NULL,
    CONSTRAINT "knowledge_documents_file_type_check" CHECK (("file_type" = ANY (ARRAY['csv'::"text", 'excel'::"text", 'word'::"text", 'pdf'::"text", 'faq'::"text"]))),
    CONSTRAINT "knowledge_documents_status_check" CHECK (("status" = ANY (ARRAY['processing'::"text", 'indexed'::"text", 'failed'::"text"]))),
    CONSTRAINT "knowledge_documents_store_check" CHECK (("store" = ANY (ARRAY['logistics'::"text", 'religious'::"text"])))
);


ALTER TABLE "public"."knowledge_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."knowledge_gaps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "topic" "text" NOT NULL,
    "normalized_topic" "text" NOT NULL,
    "sample_question" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "times_seen" integer DEFAULT 1 NOT NULL,
    "last_phone_e164" "text",
    "first_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "knowledge_gaps_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'addressed'::"text", 'dismissed'::"text"])))
);


ALTER TABLE "public"."knowledge_gaps" OWNER TO "postgres";


COMMENT ON TABLE "public"."knowledge_gaps" IS 'Topics the AI agent could not answer from indexed content, flagged for the team to publish FAQs.';



CREATE TABLE IF NOT EXISTS "public"."knowledge_suggestions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "question" "text" NOT NULL,
    "suggested_answer" "text" NOT NULL,
    "category" "text",
    "source_phone" "text",
    "source_excerpt" "text",
    "confidence" numeric,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "dedup_key" "text" NOT NULL,
    "knowledge_document_id" "uuid",
    "reviewed_by" "text",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "department_id" "uuid",
    CONSTRAINT "knowledge_suggestions_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."knowledge_suggestions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lisan_word_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "word" "text" NOT NULL,
    "normalized_word" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "times_seen" integer DEFAULT 1 NOT NULL,
    "last_phone_e164" "text",
    "alerted_at" timestamp with time zone,
    "first_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "lisan_word_requests_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'added'::"text", 'dismissed'::"text"])))
);


ALTER TABLE "public"."lisan_word_requests" OWNER TO "postgres";


COMMENT ON TABLE "public"."lisan_word_requests" IS 'Words members asked for that are missing from the Lisan ud Dawat dictionary, queued for the team to add.';



CREATE TABLE IF NOT EXISTS "public"."lisan_words" (
    "id" bigint NOT NULL,
    "transliteration" "text",
    "lisan" "text",
    "meaning" "text",
    "example" "text",
    "norm" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "norm_skeleton" "text",
    "skeleton_forms" "text"[],
    "lisan_forms" "text"[],
    "meaning_terms" "text"[],
    "lisan_norm" "text",
    "lisan_forms_norm" "text"[]
);


ALTER TABLE "public"."lisan_words" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."lisan_words_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."lisan_words_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."lisan_words_id_seq" OWNED BY "public"."lisan_words"."id";



CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone_e164" "text" NOT NULL,
    "direction" "text" NOT NULL,
    "whatsapp_message_id" "text",
    "body" "text",
    "message_type" "text",
    "raw_payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "phone_number_id" "text",
    CONSTRAINT "messages_direction_check" CHECK (("direction" = ANY (ARRAY['inbound'::"text", 'outbound'::"text"])))
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."milestones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "department_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "budget" numeric(12,2),
    "percent_complete" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "milestones_percent_complete_check" CHECK ((("percent_complete" >= 0) AND ("percent_complete" <= 100))),
    CONSTRAINT "milestones_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'in_progress'::"text", 'blocked'::"text", 'complete'::"text"])))
);


ALTER TABLE "public"."milestones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mumin_phone_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone_e164" "text" NOT NULL,
    "mumin_id" "uuid" NOT NULL,
    "source" "text" DEFAULT 'registration'::"text" NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mumin_phone_links_source_check" CHECK (("source" = ANY (ARRAY['registration'::"text", 'manual'::"text", 'inferred'::"text"])))
);


ALTER TABLE "public"."mumin_phone_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mumineen" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "its" "text" NOT NULL,
    "family_id" "uuid",
    "hof_its" "text" NOT NULL,
    "is_head" boolean DEFAULT false NOT NULL,
    "roster_active" boolean DEFAULT true NOT NULL,
    "full_name" "text",
    "gender" "text",
    "age" integer,
    "is_adult" boolean GENERATED ALWAYS AS (("age" >= 18)) STORED,
    "jamaat" "text",
    "idara" "text",
    "category" "text",
    "prefix" "text",
    "title" "text",
    "venue" "text",
    "city" "text",
    "local_mehman" "text",
    "roster_arrival_raw" "text",
    "roster_flight_code" "text",
    "daily_trans" "text",
    "whatsapp_link_clicked" boolean,
    "whatsapp_e164" "text",
    "email" "text",
    "arrival_at" timestamp with time zone,
    "arrival_flight_no" "text",
    "departure_at" timestamp with time zone,
    "departure_flight_no" "text",
    "rahat_seating" boolean DEFAULT false NOT NULL,
    "wheelchair" boolean DEFAULT false NOT NULL,
    "special_needs" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "airport" "text",
    "not_attending" boolean DEFAULT false NOT NULL,
    "wants_khidmat" boolean DEFAULT false NOT NULL,
    "khidmat_department_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    CONSTRAINT "mumineen_gender_check" CHECK (("gender" = ANY (ARRAY['M'::"text", 'F'::"text"])))
);


ALTER TABLE "public"."mumineen" OWNER TO "postgres";


COMMENT ON COLUMN "public"."mumineen"."airport" IS 'Travel airport chosen during registration (ORD or MDW).';



COMMENT ON COLUMN "public"."mumineen"."not_attending" IS 'Marked during registration: this roster member will not be attending.';



COMMENT ON COLUMN "public"."mumineen"."khidmat_department_ids" IS 'Departments this member signed up to do khidmat for (max 3), chosen during registration.';



CREATE TABLE IF NOT EXISTS "public"."mumineen_import_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "imported_by_user_id" "uuid",
    "imported_by_name" "text",
    "file_name" "text",
    "file_size_bytes" integer,
    "rows_in_file" integer,
    "families_upserted" integer,
    "mumineen_upserted" integer,
    "deactivated_missing" boolean,
    "auto_columns" "text"[],
    "status" "text" DEFAULT 'success'::"text" NOT NULL,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mumineen_import_log_status_check" CHECK (("status" = ANY (ARRAY['success'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."mumineen_import_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."mumineen_import_log" IS 'Audit trail for every mumineen roster import — who uploaded, when, and what changed.';



CREATE TABLE IF NOT EXISTS "public"."niyaz_event_config" (
    "event_date" "date" NOT NULL,
    "rsvp_event_title" "text",
    "lunch_menu" "text",
    "dinner_menu" "text",
    "rsvp_end_time" "text",
    "has_lunch" boolean DEFAULT false NOT NULL,
    "has_dinner" boolean DEFAULT false NOT NULL,
    "template_code" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "day_id" bigint NOT NULL,
    "confirmation_template_code" "text",
    "confirmation_variable_bindings" "jsonb",
    "confirmation_buttons" "jsonb",
    "rsvp_end_at" timestamp with time zone
);


ALTER TABLE "public"."niyaz_event_config" OWNER TO "postgres";


ALTER TABLE "public"."niyaz_event_config" ALTER COLUMN "day_id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."niyaz_event_config_day_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."niyaz_rsvp" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "registration_instance_id" "uuid" NOT NULL,
    "mumin_id" "uuid" NOT NULL,
    "family_id" "uuid",
    "attending" boolean NOT NULL,
    "source" "text" DEFAULT 'default'::"text" NOT NULL,
    "responded_by_phone" "text",
    "recorded_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "niyaz_rsvp_source_check" CHECK (("source" = ANY (ARRAY['default'::"text", 'registration'::"text", 'whatsapp'::"text", 'admin'::"text", 'roster'::"text"])))
);


ALTER TABLE "public"."niyaz_rsvp" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rsvp_registration_instance" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "opens_at" timestamp with time zone,
    "closes_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "event_at" timestamp with time zone,
    "venue_name" "text",
    "venue_address" "text",
    "description" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "meal" "text",
    "event_date" "date",
    "serving_type" "text",
    "hijri_date" "text",
    "thaal_wardi_count" integer,
    "actual_count" integer,
    CONSTRAINT "rsvp_registration_instance_actual_count_check" CHECK ((("actual_count" IS NULL) OR ("actual_count" >= 0))),
    CONSTRAINT "rsvp_registration_instance_meal_check" CHECK ((("meal" IS NULL) OR ("meal" = ANY (ARRAY['lunch'::"text", 'dinner'::"text"])))),
    CONSTRAINT "rsvp_registration_instance_serving_type_check" CHECK ((("serving_type" IS NULL) OR ("serving_type" = ANY (ARRAY['thaal'::"text", 'packet'::"text"])))),
    CONSTRAINT "rsvp_registration_instance_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'open'::"text", 'closed'::"text"]))),
    CONSTRAINT "rsvp_registration_instance_thaal_wardi_count_check" CHECK ((("thaal_wardi_count" IS NULL) OR ("thaal_wardi_count" >= 0)))
);


ALTER TABLE "public"."rsvp_registration_instance" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."niyaz_event_tallies" WITH ("security_invoker"='on') AS
 SELECT "i"."id" AS "instance_id",
    "count"(*) FILTER (WHERE ("r"."attending" AND COALESCE("m"."is_adult", true))) AS "yes_adults",
    "count"(*) FILTER (WHERE ("r"."attending" AND ("m"."is_adult" = false))) AS "yes_kids",
    "count"(DISTINCT "r"."family_id") FILTER (WHERE "r"."attending") AS "yes_families",
    "ceil"((("count"(*) FILTER (WHERE "r"."attending"))::numeric / (8)::numeric)) AS "thaal_count",
    "count"(*) FILTER (WHERE ((NOT "r"."attending") AND COALESCE("m"."is_adult", true))) AS "no_adults",
    "count"(*) FILTER (WHERE ((NOT "r"."attending") AND ("m"."is_adult" = false))) AS "no_kids",
    "count"(DISTINCT "r"."family_id") FILTER (WHERE (NOT "r"."attending")) AS "no_families"
   FROM (("public"."rsvp_registration_instance" "i"
     LEFT JOIN "public"."niyaz_rsvp" "r" ON (("r"."registration_instance_id" = "i"."id")))
     LEFT JOIN "public"."mumineen" "m" ON (("m"."id" = "r"."mumin_id")))
  GROUP BY "i"."id";


ALTER VIEW "public"."niyaz_event_tallies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."niyaz_family_headcount" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "registration_instance_id" "uuid" NOT NULL,
    "family_id" "uuid" NOT NULL,
    "head_count" integer DEFAULT 0 NOT NULL,
    "source" "text" DEFAULT 'whatsapp'::"text" NOT NULL,
    "responded_by_phone" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "niyaz_family_headcount_count_check" CHECK (("head_count" >= 0))
);


ALTER TABLE "public"."niyaz_family_headcount" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."niyaz_rsvp_backup_20260616" (
    "id" "uuid",
    "registration_instance_id" "uuid",
    "mumin_id" "uuid",
    "family_id" "uuid",
    "attending" boolean,
    "source" "text",
    "responded_by_phone" "text",
    "recorded_by" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."niyaz_rsvp_backup_20260616" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."niyaz_rsvp_backup_jun20_24" (
    "id" "uuid",
    "registration_instance_id" "uuid",
    "mumin_id" "uuid",
    "family_id" "uuid",
    "attending" boolean,
    "source" "text",
    "responded_by_phone" "text",
    "recorded_by" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."niyaz_rsvp_backup_jun20_24" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."niyaz_rsvp_prompts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone_e164" "text" NOT NULL,
    "family_id" "uuid",
    "event_date" "date" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "consumed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."niyaz_rsvp_prompts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."niyaz_rsvp_reg_backup_20260616" (
    "id" "uuid",
    "registration_instance_id" "uuid",
    "mumin_id" "uuid",
    "family_id" "uuid",
    "attending" boolean,
    "source" "text",
    "responded_by_phone" "text",
    "recorded_by" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."niyaz_rsvp_reg_backup_20260616" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."parking_lots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "capacity" integer DEFAULT 0 NOT NULL,
    "color" "text",
    "purposes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."parking_lots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."parking_passes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "family_id" "uuid" NOT NULL,
    "lot_id" "uuid" NOT NULL,
    "assigned_by" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "printed_at" timestamp with time zone
);


ALTER TABLE "public"."parking_passes" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."phone_message_stats" WITH ("security_invoker"='on') AS
 SELECT "phone_e164",
    "count"(*) FILTER (WHERE ("direction" = 'inbound'::"text")) AS "inbound_count",
    "count"(*) FILTER (WHERE ("direction" = 'outbound'::"text")) AS "outbound_count",
    "max"("created_at") FILTER (WHERE ("direction" = 'inbound'::"text")) AS "last_inbound_at",
    "max"("created_at") FILTER (WHERE ("direction" = 'outbound'::"text")) AS "last_outbound_at"
   FROM "public"."messages"
  GROUP BY "phone_e164";


ALTER VIEW "public"."phone_message_stats" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."phone_template_sends" WITH ("security_invoker"='on') AS
 SELECT "phone_e164",
    "substring"("body", '^\[template:([^]]+)\]'::"text") AS "template_code",
    "max"("created_at") AS "last_sent_at",
    "count"(*) AS "send_count"
   FROM "public"."messages"
  WHERE (("direction" = 'outbound'::"text") AND ("body" ~~ '[template:%'::"text"))
  GROUP BY "phone_e164", ("substring"("body", '^\[template:([^]]+)\]'::"text"));


ALTER VIEW "public"."phone_template_sends" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tool_audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "phone_e164" "text",
    "tool_name" "text" NOT NULL,
    "arguments" "jsonb",
    "allowed" boolean NOT NULL,
    "result_summary" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tool_audit_logs" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."phone_tool_usage" WITH ("security_invoker"='on') AS
 SELECT "phone_e164",
    "tool_name",
    "max"("created_at") AS "last_used_at",
    "count"(*) AS "use_count"
   FROM "public"."tool_audit_logs"
  WHERE ("allowed" = true)
  GROUP BY "phone_e164", "tool_name";


ALTER VIEW "public"."phone_tool_usage" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quiz_answers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recipient_id" "uuid" NOT NULL,
    "quiz_key" "text" NOT NULL,
    "question_id" "text" NOT NULL,
    "chosen_index" integer,
    "is_correct" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."quiz_answers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quiz_recipients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "quiz_key" "text" NOT NULL,
    "mumin_id" "uuid",
    "family_id" "uuid",
    "phone_e164" "text",
    "display_name" "text",
    "token" "text",
    "status" "text" DEFAULT 'sampled'::"text" NOT NULL,
    "score" integer,
    "total" integer,
    "is_test" boolean DEFAULT false NOT NULL,
    "broadcast_recipient_id" "uuid",
    "sent_at" timestamp with time zone,
    "opened_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "its_number" "text",
    "time_taken_seconds" integer,
    "duration_seconds" integer,
    CONSTRAINT "quiz_recipients_status_check" CHECK (("status" = ANY (ARRAY['sampled'::"text", 'sent'::"text", 'opened'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."quiz_recipients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quizzes" (
    "quiz_key" "text" NOT NULL,
    "share_token" "text" NOT NULL,
    "is_open" boolean DEFAULT true NOT NULL,
    "title" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."quizzes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."registration_otps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "hof_its" "text" NOT NULL,
    "otp_hash" "text" NOT NULL,
    "recipient_its" "text" NOT NULL,
    "email_sent_to" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "verified_at" timestamp with time zone,
    "edit_token" "text",
    "edit_token_expires_at" timestamp with time zone,
    "edit_used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."registration_otps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."relay_updates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "date" "date" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "category" "text" NOT NULL,
    "link" "text",
    "cta" "text",
    "published" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "relay_updates_category_check" CHECK (("category" = ANY (ARRAY['urgent'::"text", 'schedule'::"text", 'travel'::"text", 'advisory'::"text"])))
);


ALTER TABLE "public"."relay_updates" OWNER TO "postgres";


COMMENT ON TABLE "public"."relay_updates" IS 'Updates shown on the public relay-center page (and indexed for the WhatsApp agent).';



CREATE TABLE IF NOT EXISTS "public"."religious_content" (
    "id" bigint NOT NULL,
    "page_url" "text" NOT NULL,
    "page_title" "text",
    "section" "text",
    "content" "text" NOT NULL,
    "embedding" "extensions"."vector"(1536),
    "source_type" "text" DEFAULT 'topic_block'::"text" NOT NULL,
    "indexed_at" timestamp with time zone DEFAULT "now"(),
    "is_current" boolean DEFAULT true,
    "source_url" "text",
    "source_label" "text",
    "year_hijri" "text",
    "majlis_number" integer,
    "is_ashura" boolean DEFAULT false,
    "category" "text",
    CONSTRAINT "religious_content_source_type_check" CHECK (("source_type" = ANY (ARRAY['topic_block'::"text", 'uploaded_doc'::"text"])))
);


ALTER TABLE "public"."religious_content" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."religious_content_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."religious_content_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."religious_content_id_seq" OWNED BY "public"."religious_content"."id";



CREATE TABLE IF NOT EXISTS "public"."religious_monitors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."religious_monitors" OWNER TO "postgres";


COMMENT ON TABLE "public"."religious_monitors" IS 'Users who may monitor religious chats on /admin/religious (and nothing else, unless otherwise privileged).';



CREATE TABLE IF NOT EXISTS "public"."religious_ruling_flags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone_e164" "text" NOT NULL,
    "message" "text" NOT NULL,
    "detected_by" "text" NOT NULL,
    "reviewed" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "religious_ruling_flags_detected_by_check" CHECK (("detected_by" = ANY (ARRAY['keyword'::"text", 'classifier'::"text"])))
);


ALTER TABLE "public"."religious_ruling_flags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."religious_topics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "title" "text" NOT NULL,
    "content" "text" DEFAULT ''::"text" NOT NULL,
    "chunk_count" integer DEFAULT 0 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "updated_by" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source_url" "text",
    "source_label" "text",
    "year_hijri" "text",
    "majlis_number" integer,
    "is_ashura" boolean DEFAULT false NOT NULL,
    "category" "text",
    "language" "text" DEFAULT 'en'::"text" NOT NULL,
    "status" "text" DEFAULT 'indexed'::"text" NOT NULL,
    "theme" "text",
    CONSTRAINT "religious_topics_category_chk" CHECK ((("category" IS NULL) OR ("category" = ANY (ARRAY['reflection'::"text", 'tazyeen'::"text", 'al_dars'::"text", 'jumla'::"text", 'kalema'::"text", 'unwaan'::"text", 'overview'::"text", 'faq'::"text", 'misc'::"text"])))),
    CONSTRAINT "religious_topics_language_chk" CHECK (("language" = ANY (ARRAY['en'::"text", 'lisan'::"text"]))),
    CONSTRAINT "religious_topics_status_chk" CHECK (("status" = ANY (ARRAY['indexed'::"text", 'pending_translation'::"text", 'placeholder'::"text"])))
);


ALTER TABLE "public"."religious_topics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rsvp_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "registration_instance_id" "uuid" NOT NULL,
    "family_id" "uuid" NOT NULL,
    "submitted_by_mumin_id" "uuid",
    "response" "text",
    "head_count" integer,
    "responded_by_phone" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text" DEFAULT 'admin'::"text" NOT NULL,
    "recorded_by" "text",
    CONSTRAINT "rsvp_responses_head_count_check" CHECK ((("head_count" IS NULL) OR ("head_count" >= 0))),
    CONSTRAINT "rsvp_responses_response_check" CHECK (("response" = ANY (ARRAY['yes'::"text", 'no'::"text", 'maybe'::"text"]))),
    CONSTRAINT "rsvp_responses_source_check" CHECK (("source" = ANY (ARRAY['whatsapp'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."rsvp_responses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."site_content" (
    "id" bigint NOT NULL,
    "page_url" "text" NOT NULL,
    "page_title" "text",
    "section" "text",
    "content" "text" NOT NULL,
    "embedding" "extensions"."vector"(1536),
    "scraped_at" timestamp with time zone DEFAULT "now"(),
    "is_current" boolean DEFAULT true
);


ALTER TABLE "public"."site_content" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."site_content_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."site_content_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."site_content_id_seq" OWNED BY "public"."site_content"."id";



CREATE TABLE IF NOT EXISTS "public"."survey_answers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recipient_id" "uuid" NOT NULL,
    "form_id" "uuid",
    "mumin_id" "uuid",
    "family_id" "uuid",
    "section_id" "uuid",
    "question_id" "uuid",
    "area" "text",
    "answer_text" "text",
    "answer_numeric" integer,
    "reason_text" "text",
    "sentiment_1_5" integer,
    "department_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "event_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "survey_answers_sentiment_1_5_check" CHECK ((("sentiment_1_5" IS NULL) OR (("sentiment_1_5" >= 1) AND ("sentiment_1_5" <= 5))))
);


ALTER TABLE "public"."survey_answers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."survey_form_questions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "form_id" "uuid" NOT NULL,
    "section_id" "uuid",
    "question_id" "uuid",
    "area" "text",
    "snapshot" "jsonb" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."survey_form_questions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."survey_forms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "group_id" "uuid",
    "sample_size" integer DEFAULT 40 NOT NULL,
    "event_date" "date",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sent_at" timestamp with time zone,
    "rules" "jsonb",
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "sample_plan" "jsonb",
    "public_title" "text",
    "resend_until_responded" boolean DEFAULT false NOT NULL,
    "census" boolean DEFAULT false NOT NULL,
    "template_phrase" "text",
    CONSTRAINT "survey_forms_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'sampled'::"text", 'sent'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."survey_forms" OWNER TO "postgres";


COMMENT ON COLUMN "public"."survey_forms"."census" IS 'When true, the form is sent to ALL eligible people (attending+registered+reachable, deduped by phone) with no sample size / one-per-day / exhaustion / non-responder limits.';



COMMENT ON COLUMN "public"."survey_forms"."template_phrase" IS 'Second WhatsApp template body parameter (after mumin_name) — a per-form phrase, e.g. "your Farzand''s experience" / "your overall ashara experience". Bound to body var #2+ when the template has more than one.';



CREATE TABLE IF NOT EXISTS "public"."survey_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "rules" "jsonb" NOT NULL,
    "area_focus" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."survey_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."survey_question_exposures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mumin_id" "uuid" NOT NULL,
    "question_id" "uuid" NOT NULL,
    "form_id" "uuid",
    "event_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."survey_question_exposures" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."survey_questions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "section_id" "uuid" NOT NULL,
    "text" "text" NOT NULL,
    "type" "text" NOT NULL,
    "options" "jsonb",
    "negative_values" "jsonb",
    "polarity" "text" DEFAULT 'positive'::"text" NOT NULL,
    "is_general" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "collect_comment" boolean DEFAULT true NOT NULL,
    "comment_threshold" integer,
    "required" boolean DEFAULT false NOT NULL,
    "scored" boolean DEFAULT true NOT NULL,
    CONSTRAINT "survey_questions_polarity_check" CHECK (("polarity" = ANY (ARRAY['positive'::"text", 'negative'::"text"]))),
    CONSTRAINT "survey_questions_type_check" CHECK (("type" = ANY (ARRAY['choice'::"text", 'scale10'::"text", 'scale5'::"text", 'yesno'::"text", 'text'::"text", 'multichoice'::"text"])))
);


ALTER TABLE "public"."survey_questions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."survey_questions"."scored" IS 'When false, the question carries no 1-5 sentiment (informational/cross-tab, e.g. "where were you sitting during waaz"). answerSentiment returns null so it never counts as good/fair/negative.';



CREATE TABLE IF NOT EXISTS "public"."survey_recipients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "form_id" "uuid" NOT NULL,
    "mumin_id" "uuid",
    "family_id" "uuid",
    "phone_e164" "text",
    "group_id" "uuid",
    "token" "text" NOT NULL,
    "status" "text" DEFAULT 'sampled'::"text" NOT NULL,
    "broadcast_recipient_id" "uuid",
    "event_date" "date",
    "sent_at" timestamp with time zone,
    "opened_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_test" boolean DEFAULT false NOT NULL,
    "census" boolean DEFAULT false NOT NULL,
    CONSTRAINT "survey_recipients_status_check" CHECK (("status" = ANY (ARRAY['sampled'::"text", 'sent'::"text", 'opened'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."survey_recipients" OWNER TO "postgres";


COMMENT ON COLUMN "public"."survey_recipients"."census" IS 'True for recipients created by a census send. The daily sampler ignores these rows so census blasts do not consume the one-per-day pool.';



CREATE TABLE IF NOT EXISTS "public"."survey_sections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "area" "text" NOT NULL,
    "is_general" boolean DEFAULT false NOT NULL,
    "default_rule" "jsonb",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dedup_exempt" boolean DEFAULT false NOT NULL,
    CONSTRAINT "survey_sections_area_check" CHECK (("area" = ANY (ARRAY['mawaid'::"text", 'flow'::"text", 'parking_transport'::"text", 'audio_video'::"text", 'accommodation'::"text", 'seating'::"text", 'general'::"text"])))
);


ALTER TABLE "public"."survey_sections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_prompts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prompt_key" "text" NOT NULL,
    "prompt_text" "text" NOT NULL,
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."system_prompts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "department_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "assigned_to" "uuid",
    "created_by" "uuid",
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "due_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "archived" boolean DEFAULT false NOT NULL,
    "milestone_id" "uuid",
    "item_type" "text" DEFAULT 'task'::"text" NOT NULL,
    "origin" "text" DEFAULT 'internal'::"text" NOT NULL,
    "source_phone" "text",
    CONSTRAINT "tasks_item_type_check" CHECK (("item_type" = ANY (ARRAY['task'::"text", 'issue'::"text"]))),
    CONSTRAINT "tasks_origin_check" CHECK (("origin" = ANY (ARRAY['external'::"text", 'internal'::"text"]))),
    CONSTRAINT "tasks_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "tasks_source_check" CHECK (("source" = ANY (ARRAY['transcript'::"text", 'whatsapp_agent'::"text", 'manual'::"text"]))),
    CONSTRAINT "tasks_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'in_progress'::"text", 'blocked'::"text", 'complete'::"text"])))
);


ALTER TABLE "public"."tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."template_broadcast_recipients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "broadcast_id" "uuid" NOT NULL,
    "family_id" "uuid",
    "phone_e164" "text" NOT NULL,
    "was_in_window" boolean DEFAULT false NOT NULL,
    "wa_message_id" "text",
    "send_status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "error_detail" "text",
    "sent_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "read_at" timestamp with time zone,
    "replied_at" timestamp with time zone,
    "body_params" "jsonb",
    "skip_reason" "text",
    "claimed_at" timestamp with time zone,
    CONSTRAINT "template_broadcast_recipients_send_status_check" CHECK (("send_status" = ANY (ARRAY['queued'::"text", 'sending'::"text", 'sent'::"text", 'failed'::"text", 'delivered'::"text", 'read'::"text", 'replied'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."template_broadcast_recipients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."template_broadcasts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_code" "text",
    "template_language" "text" DEFAULT 'en_US'::"text" NOT NULL,
    "audience_key" "text" NOT NULL,
    "triggered_by_user_id" "uuid",
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "total_recipients" integer DEFAULT 0 NOT NULL,
    "count_free" integer DEFAULT 0 NOT NULL,
    "count_paid" integer DEFAULT 0 NOT NULL,
    "count_excluded" integer DEFAULT 0 NOT NULL,
    "count_sent" integer DEFAULT 0 NOT NULL,
    "count_failed" integer DEFAULT 0 NOT NULL,
    "est_cost_usd" numeric(10,2) DEFAULT 0 NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "audience_rules" "jsonb",
    "variable_bindings" "jsonb",
    "count_skipped" integer DEFAULT 0 NOT NULL,
    "batch_size" integer,
    "send_interval_ms" integer,
    "window_filter" "text",
    "window_hours" integer,
    "selected_user_ids" "uuid"[],
    "phone_number_id" "text",
    "message_kind" "text" DEFAULT 'template'::"text" NOT NULL,
    "freeform_text" "text",
    CONSTRAINT "template_broadcasts_batch_size_check" CHECK ((("batch_size" IS NULL) OR (("batch_size" >= 1) AND ("batch_size" <= 150)))),
    CONSTRAINT "template_broadcasts_kind_payload_check" CHECK (((("message_kind" = 'template'::"text") AND ("template_code" IS NOT NULL)) OR (("message_kind" = 'text'::"text") AND ("freeform_text" IS NOT NULL)))),
    CONSTRAINT "template_broadcasts_message_kind_check" CHECK (("message_kind" = ANY (ARRAY['template'::"text", 'text'::"text"]))),
    CONSTRAINT "template_broadcasts_send_interval_ms_check" CHECK ((("send_interval_ms" IS NULL) OR (("send_interval_ms" >= 0) AND ("send_interval_ms" <= 60000)))),
    CONSTRAINT "template_broadcasts_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."template_broadcasts" OWNER TO "postgres";


COMMENT ON COLUMN "public"."template_broadcasts"."batch_size" IS 'Max recipients the drain sends per invocation for this broadcast (1-150). Null = env/default.';



COMMENT ON COLUMN "public"."template_broadcasts"."send_interval_ms" IS 'Delay between individual sends within a drain batch, in ms (0-60000). Null = env/default.';



CREATE TABLE IF NOT EXISTS "public"."transcript_function_calls" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "upload_id" "uuid",
    "department_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "transcript_type" "text" DEFAULT 'whatsapp'::"text" NOT NULL,
    "function_name" "text" NOT NULL,
    "model" "text",
    "request_prompt" "text",
    "request_context" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "raw_response" "jsonb",
    "arguments" "jsonb",
    "parse_error" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "transcript_function_calls_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'succeeded'::"text", 'failed'::"text"]))),
    CONSTRAINT "transcript_function_calls_transcript_type_check" CHECK (("transcript_type" = ANY (ARRAY['whatsapp'::"text", 'meeting'::"text"])))
);


ALTER TABLE "public"."transcript_function_calls" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."unregistered_rsvps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone_e164" "text" NOT NULL,
    "registration_instance_id" "uuid" NOT NULL,
    "adults" integer DEFAULT 1 NOT NULL,
    "kids" integer DEFAULT 0 NOT NULL,
    "attending" boolean DEFAULT true NOT NULL,
    "its_number" "text",
    "family_name" "text",
    "source" "text" DEFAULT 'whatsapp'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "unregistered_rsvps_adults_check" CHECK (("adults" >= 0)),
    CONSTRAINT "unregistered_rsvps_kids_check" CHECK (("kids" >= 0)),
    CONSTRAINT "unregistered_rsvps_source_check" CHECK (("source" = ANY (ARRAY['whatsapp'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."unregistered_rsvps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."unregistered_rsvps_backup_20260616" (
    "id" "uuid",
    "phone_e164" "text",
    "registration_instance_id" "uuid",
    "adults" integer,
    "kids" integer,
    "attending" boolean,
    "its_number" "text",
    "family_name" "text",
    "source" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."unregistered_rsvps_backup_20260616" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."webinars" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "youtube_url" "text" NOT NULL,
    "description" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_by_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "seq" integer NOT NULL
);


ALTER TABLE "public"."webinars" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."webinars_seq_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."webinars_seq_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."webinars_seq_seq" OWNED BY "public"."webinars"."seq";



CREATE TABLE IF NOT EXISTS "public"."whatsapp_inbound_locks" (
    "lock_key" "text" NOT NULL,
    "owner_token" "uuid" NOT NULL,
    "acquired_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL
);


ALTER TABLE "public"."whatsapp_inbound_locks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_interactive_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone_e164" "text" NOT NULL,
    "wa_message_id" "text",
    "response_type" "text" NOT NULL,
    "flow_token" "text",
    "payload" "jsonb",
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "whatsapp_interactive_responses_response_type_check" CHECK (("response_type" = ANY (ARRAY['flow'::"text", 'button'::"text"])))
);


ALTER TABLE "public"."whatsapp_interactive_responses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_pending_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lock_key" "text" NOT NULL,
    "phone_e164" "text" NOT NULL,
    "message_id" "text" NOT NULL,
    "body" "text" NOT NULL,
    "inbound_msg_id" "uuid",
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "claimed_at" timestamp with time zone,
    "claimed_by" "uuid"
);


ALTER TABLE "public"."whatsapp_pending_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_template_settings" (
    "template_name" "text" NOT NULL,
    "friendly_name" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "waba_id" "text"
);


ALTER TABLE "public"."whatsapp_template_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_undeliverable" (
    "phone_e164" "text" NOT NULL,
    "fail_count" integer DEFAULT 0 NOT NULL,
    "first_failed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_failed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_error_code" integer,
    "suppressed" boolean DEFAULT false NOT NULL,
    "suppressed_at" timestamp with time zone,
    "cleared_at" timestamp with time zone,
    "cleared_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."whatsapp_undeliverable" OWNER TO "postgres";


COMMENT ON TABLE "public"."whatsapp_undeliverable" IS 'Phone-keyed suppression list for numbers Meta reports as undeliverable (not on WhatsApp / can''t receive). Once suppressed, the audience layer skips the number on all future broadcasts. Server-only (service role); accessed via /api/admin/whatsapp/undeliverable.';



CREATE TABLE IF NOT EXISTS "public"."whatsapp_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone_e164" "text" NOT NULL,
    "display_name" "text",
    "role" "text" DEFAULT 'visitor'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "jamaat" "text",
    "city" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "email" "text",
    "global_role" "text" DEFAULT 'member'::"text",
    "transcript_aliases" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "email_digest" boolean DEFAULT true NOT NULL,
    "password_hash" "text",
    "password_updated_at" timestamp with time zone,
    "password_reset_token_hash" "text",
    "password_reset_expires_at" timestamp with time zone,
    "last_login_at" timestamp with time zone,
    "welcomed_at" timestamp with time zone,
    CONSTRAINT "whatsapp_users_global_role_check" CHECK (("global_role" = ANY (ARRAY['member'::"text", 'pm'::"text", 'hod'::"text", 'leadership_admin'::"text"]))),
    CONSTRAINT "whatsapp_users_role_check" CHECK (("role" = ANY (ARRAY['visitor'::"text", 'committee'::"text", 'admin'::"text", 'helpdesk'::"text"]))),
    CONSTRAINT "whatsapp_users_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text"])))
);


ALTER TABLE "public"."whatsapp_users" OWNER TO "postgres";


ALTER TABLE ONLY "public"."issues" ALTER COLUMN "issue_number" SET DEFAULT "nextval"('"public"."issues_issue_number_seq"'::"regclass");



ALTER TABLE ONLY "public"."lisan_words" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."lisan_words_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."religious_content" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."religious_content_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."site_content" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."site_content_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."webinars" ALTER COLUMN "seq" SET DEFAULT "nextval"('"public"."webinars_seq_seq"'::"regclass");



ALTER TABLE ONLY "public"."accommodation_host_imports"
    ADD CONSTRAINT "accommodation_host_imports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."accommodation_hosts"
    ADD CONSTRAINT "accommodation_hosts_hof_its_key" UNIQUE ("hof_its");



ALTER TABLE ONLY "public"."accommodation_hosts"
    ADD CONSTRAINT "accommodation_hosts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."accommodation_matches"
    ADD CONSTRAINT "accommodation_matches_guest_family_id_host_id_key" UNIQUE ("guest_family_id", "host_id");



ALTER TABLE ONLY "public"."accommodation_matches"
    ADD CONSTRAINT "accommodation_matches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."broadcast_recipients"
    ADD CONSTRAINT "broadcast_recipients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."broadcasts"
    ADD CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."committee_permissions"
    ADD CONSTRAINT "committee_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."committee_permissions"
    ADD CONSTRAINT "committee_permissions_user_id_permission_key_key" UNIQUE ("user_id", "permission_key");



ALTER TABLE ONLY "public"."conversation_events"
    ADD CONSTRAINT "conversation_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversation_sessions"
    ADD CONSTRAINT "conversation_sessions_phone_e164_key" UNIQUE ("phone_e164");



ALTER TABLE ONLY "public"."conversation_sessions"
    ADD CONSTRAINT "conversation_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversation_upload_departments"
    ADD CONSTRAINT "conversation_upload_departments_pkey" PRIMARY KEY ("upload_id", "department_id");



ALTER TABLE ONLY "public"."conversation_uploads"
    ADD CONSTRAINT "conversation_uploads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cron_job_logs"
    ADD CONSTRAINT "cron_job_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."department_contacts"
    ADD CONSTRAINT "department_contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."department_daily_summaries"
    ADD CONSTRAINT "department_daily_summaries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."department_members"
    ADD CONSTRAINT "department_members_department_id_user_id_key" UNIQUE ("department_id", "user_id");



ALTER TABLE ONLY "public"."department_members"
    ADD CONSTRAINT "department_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."department_prompt_config"
    ADD CONSTRAINT "department_prompt_config_dept_type_unique" UNIQUE ("department_id", "transcript_type");



ALTER TABLE ONLY "public"."department_prompt_config"
    ADD CONSTRAINT "department_prompt_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."escalation_activity_log"
    ADD CONSTRAINT "escalation_activity_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."escalation_sla_config"
    ADD CONSTRAINT "escalation_sla_config_pkey" PRIMARY KEY ("priority");



ALTER TABLE ONLY "public"."escalation_support_members"
    ADD CONSTRAINT "escalation_support_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."escalation_support_members"
    ADD CONSTRAINT "escalation_support_members_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."families"
    ADD CONSTRAINT "families_hof_its_key" UNIQUE ("hof_its");



ALTER TABLE ONLY "public"."families"
    ADD CONSTRAINT "families_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."faq_buckets"
    ADD CONSTRAINT "faq_buckets_department_id_key" UNIQUE ("department_id");



ALTER TABLE ONLY "public"."faq_buckets"
    ADD CONSTRAINT "faq_buckets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback_entries"
    ADD CONSTRAINT "feedback_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."issue_escalation_links"
    ADD CONSTRAINT "issue_escalation_links_issue_id_conversation_session_id_key" UNIQUE ("issue_id", "conversation_session_id");



ALTER TABLE ONLY "public"."issue_escalation_links"
    ADD CONSTRAINT "issue_escalation_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."issues"
    ADD CONSTRAINT "issues_issue_number_key" UNIQUE ("issue_number");



ALTER TABLE ONLY "public"."issues"
    ADD CONSTRAINT "issues_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."knowledge_documents"
    ADD CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."knowledge_gaps"
    ADD CONSTRAINT "knowledge_gaps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."knowledge_suggestions"
    ADD CONSTRAINT "knowledge_suggestions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lisan_word_requests"
    ADD CONSTRAINT "lisan_word_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lisan_words"
    ADD CONSTRAINT "lisan_words_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_whatsapp_message_id_key" UNIQUE ("whatsapp_message_id");



ALTER TABLE ONLY "public"."milestones"
    ADD CONSTRAINT "milestones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mumin_phone_links"
    ADD CONSTRAINT "mumin_phone_links_phone_e164_mumin_id_key" UNIQUE ("phone_e164", "mumin_id");



ALTER TABLE ONLY "public"."mumin_phone_links"
    ADD CONSTRAINT "mumin_phone_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mumineen_import_log"
    ADD CONSTRAINT "mumineen_import_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mumineen"
    ADD CONSTRAINT "mumineen_its_key" UNIQUE ("its");



ALTER TABLE ONLY "public"."mumineen"
    ADD CONSTRAINT "mumineen_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."niyaz_event_config"
    ADD CONSTRAINT "niyaz_event_config_pkey" PRIMARY KEY ("event_date");



ALTER TABLE ONLY "public"."niyaz_family_headcount"
    ADD CONSTRAINT "niyaz_family_headcount_key" UNIQUE ("registration_instance_id", "family_id");



ALTER TABLE ONLY "public"."niyaz_family_headcount"
    ADD CONSTRAINT "niyaz_family_headcount_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."niyaz_rsvp"
    ADD CONSTRAINT "niyaz_rsvp_instance_mumin_key" UNIQUE ("registration_instance_id", "mumin_id");



ALTER TABLE ONLY "public"."niyaz_rsvp"
    ADD CONSTRAINT "niyaz_rsvp_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."niyaz_rsvp_prompts"
    ADD CONSTRAINT "niyaz_rsvp_prompts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."parking_lots"
    ADD CONSTRAINT "parking_lots_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."parking_lots"
    ADD CONSTRAINT "parking_lots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."parking_passes"
    ADD CONSTRAINT "parking_passes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quiz_answers"
    ADD CONSTRAINT "quiz_answers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quiz_answers"
    ADD CONSTRAINT "quiz_answers_recipient_id_question_id_key" UNIQUE ("recipient_id", "question_id");



ALTER TABLE ONLY "public"."quiz_recipients"
    ADD CONSTRAINT "quiz_recipients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quiz_recipients"
    ADD CONSTRAINT "quiz_recipients_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."quizzes"
    ADD CONSTRAINT "quizzes_pkey" PRIMARY KEY ("quiz_key");



ALTER TABLE ONLY "public"."quizzes"
    ADD CONSTRAINT "quizzes_share_token_key" UNIQUE ("share_token");



ALTER TABLE ONLY "public"."registration_otps"
    ADD CONSTRAINT "registration_otps_edit_token_key" UNIQUE ("edit_token");



ALTER TABLE ONLY "public"."registration_otps"
    ADD CONSTRAINT "registration_otps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."relay_updates"
    ADD CONSTRAINT "relay_updates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."religious_content"
    ADD CONSTRAINT "religious_content_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."religious_monitors"
    ADD CONSTRAINT "religious_monitors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."religious_monitors"
    ADD CONSTRAINT "religious_monitors_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."religious_ruling_flags"
    ADD CONSTRAINT "religious_ruling_flags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."religious_topics"
    ADD CONSTRAINT "religious_topics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."religious_topics"
    ADD CONSTRAINT "religious_topics_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."rsvp_registration_instance"
    ADD CONSTRAINT "rsvp_campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rsvp_responses"
    ADD CONSTRAINT "rsvp_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."site_content"
    ADD CONSTRAINT "site_content_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."survey_answers"
    ADD CONSTRAINT "survey_answers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."survey_form_questions"
    ADD CONSTRAINT "survey_form_questions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."survey_forms"
    ADD CONSTRAINT "survey_forms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."survey_groups"
    ADD CONSTRAINT "survey_groups_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."survey_groups"
    ADD CONSTRAINT "survey_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."survey_question_exposures"
    ADD CONSTRAINT "survey_question_exposures_mumin_id_question_id_key" UNIQUE ("mumin_id", "question_id");



ALTER TABLE ONLY "public"."survey_question_exposures"
    ADD CONSTRAINT "survey_question_exposures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."survey_questions"
    ADD CONSTRAINT "survey_questions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."survey_recipients"
    ADD CONSTRAINT "survey_recipients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."survey_recipients"
    ADD CONSTRAINT "survey_recipients_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."survey_sections"
    ADD CONSTRAINT "survey_sections_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."survey_sections"
    ADD CONSTRAINT "survey_sections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_prompts"
    ADD CONSTRAINT "system_prompts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_prompts"
    ADD CONSTRAINT "system_prompts_prompt_key_key" UNIQUE ("prompt_key");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."template_broadcast_recipients"
    ADD CONSTRAINT "template_broadcast_recipients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."template_broadcasts"
    ADD CONSTRAINT "template_broadcasts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tool_audit_logs"
    ADD CONSTRAINT "tool_audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transcript_function_calls"
    ADD CONSTRAINT "transcript_function_calls_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."unregistered_rsvps"
    ADD CONSTRAINT "unregistered_rsvps_phone_instance_key" UNIQUE ("phone_e164", "registration_instance_id");



ALTER TABLE ONLY "public"."unregistered_rsvps"
    ADD CONSTRAINT "unregistered_rsvps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."webinars"
    ADD CONSTRAINT "webinars_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."webinars"
    ADD CONSTRAINT "webinars_seq_unique" UNIQUE ("seq");



ALTER TABLE ONLY "public"."whatsapp_inbound_locks"
    ADD CONSTRAINT "whatsapp_inbound_locks_pkey" PRIMARY KEY ("lock_key");



ALTER TABLE ONLY "public"."whatsapp_interactive_responses"
    ADD CONSTRAINT "whatsapp_interactive_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_pending_messages"
    ADD CONSTRAINT "whatsapp_pending_messages_message_id_key" UNIQUE ("message_id");



ALTER TABLE ONLY "public"."whatsapp_pending_messages"
    ADD CONSTRAINT "whatsapp_pending_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_undeliverable"
    ADD CONSTRAINT "whatsapp_undeliverable_pkey" PRIMARY KEY ("phone_e164");



ALTER TABLE ONLY "public"."whatsapp_users"
    ADD CONSTRAINT "whatsapp_users_phone_e164_key" UNIQUE ("phone_e164");



ALTER TABLE ONLY "public"."whatsapp_users"
    ADD CONSTRAINT "whatsapp_users_pkey" PRIMARY KEY ("id");



CREATE INDEX "accommodation_hosts_can_provide_idx" ON "public"."accommodation_hosts" USING "btree" ("can_provide_utaro") WHERE ("can_provide_utaro" = true);



CREATE INDEX "accommodation_matches_host_idx" ON "public"."accommodation_matches" USING "btree" ("host_id");



CREATE INDEX "accommodation_matches_status_idx" ON "public"."accommodation_matches" USING "btree" ("status");



CREATE INDEX "broadcast_recipients_broadcast_idx" ON "public"."broadcast_recipients" USING "btree" ("broadcast_id", "status");



CREATE INDEX "broadcast_recipients_pending_idx" ON "public"."broadcast_recipients" USING "btree" ("status") WHERE ("status" = ANY (ARRAY['pending'::"text", 'sending'::"text"]));



CREATE INDEX "committee_permissions_permission_key_idx" ON "public"."committee_permissions" USING "btree" ("permission_key");



CREATE INDEX "conversation_events_function_call_id_idx" ON "public"."conversation_events" USING "btree" ("function_call_id");



CREATE INDEX "conversation_events_priority_idx" ON "public"."conversation_events" USING "btree" ("priority");



CREATE INDEX "conversation_events_suggested_status_idx" ON "public"."conversation_events" USING "btree" ("suggested_status");



CREATE INDEX "conversation_sessions_escalation_stage_idx" ON "public"."conversation_sessions" USING "btree" ("escalation_stage") WHERE ("escalation_stage" <> 'none'::"text");



CREATE INDEX "conversation_sessions_escalation_status_idx" ON "public"."conversation_sessions" USING "btree" ("escalation_status");



CREATE INDEX "conversation_sessions_handling_mode_idx" ON "public"."conversation_sessions" USING "btree" ("handling_mode");



CREATE INDEX "conversation_sessions_last_message_at_idx" ON "public"."conversation_sessions" USING "btree" ("last_message_at" DESC);



CREATE INDEX "conversation_sessions_linked_issue_idx" ON "public"."conversation_sessions" USING "btree" ("linked_issue_id") WHERE ("linked_issue_id" IS NOT NULL);



CREATE INDEX "conversation_sessions_linked_task_idx" ON "public"."conversation_sessions" USING "btree" ("linked_task_id") WHERE ("linked_task_id" IS NOT NULL);



CREATE INDEX "conversation_sessions_phone_number_id_idx" ON "public"."conversation_sessions" USING "btree" ("phone_number_id");



CREATE INDEX "conversation_sessions_sla_deadline_idx" ON "public"."conversation_sessions" USING "btree" ("escalation_sla_deadline") WHERE (("escalation_sla_deadline" IS NOT NULL) AND ("escalation_stage" <> ALL (ARRAY['none'::"text", 'resolved'::"text"])));



CREATE INDEX "conversation_sessions_user_id_idx" ON "public"."conversation_sessions" USING "btree" ("user_id");



CREATE INDEX "conversation_upload_departments_department_id_idx" ON "public"."conversation_upload_departments" USING "btree" ("department_id");



CREATE INDEX "cron_job_logs_job_key_idx" ON "public"."cron_job_logs" USING "btree" ("job_key");



CREATE INDEX "cron_job_logs_started_at_idx" ON "public"."cron_job_logs" USING "btree" ("started_at" DESC);



CREATE INDEX "department_contacts_department_id_idx" ON "public"."department_contacts" USING "btree" ("department_id", "display_order");



CREATE UNIQUE INDEX "department_daily_summaries_allup_day_key" ON "public"."department_daily_summaries" USING "btree" ("summary_date") WHERE ("department_id" IS NULL);



CREATE UNIQUE INDEX "department_daily_summaries_dept_day_key" ON "public"."department_daily_summaries" USING "btree" ("department_id", "summary_date") WHERE ("department_id" IS NOT NULL);



CREATE INDEX "department_members_feedback_digest_idx" ON "public"."department_members" USING "btree" ("department_id") WHERE (("is_active" = true) AND ("daily_feedback_digest" = true));



CREATE INDEX "department_members_issue_contacts_idx" ON "public"."department_members" USING "btree" ("department_id") WHERE (("is_active" = true) AND ("contact_for_issues" = true));



CREATE INDEX "department_prompt_config_department_id_idx" ON "public"."department_prompt_config" USING "btree" ("department_id");



CREATE INDEX "department_prompt_config_dept_type_idx" ON "public"."department_prompt_config" USING "btree" ("department_id", "transcript_type");



CREATE INDEX "escalation_activity_log_session_idx" ON "public"."escalation_activity_log" USING "btree" ("conversation_session_id");



CREATE INDEX "escalation_activity_log_task_idx" ON "public"."escalation_activity_log" USING "btree" ("task_id");



CREATE INDEX "feedback_entries_area_date_idx" ON "public"."feedback_entries" USING "btree" ("area", "event_date");



CREATE INDEX "feedback_entries_depts_gin" ON "public"."feedback_entries" USING "gin" ("department_ids");



CREATE INDEX "feedback_entries_event_date_idx" ON "public"."feedback_entries" USING "btree" ("event_date");



CREATE INDEX "feedback_entries_family_idx" ON "public"."feedback_entries" USING "btree" ("family_id");



CREATE INDEX "idx_conversation_events_upload_id" ON "public"."conversation_events" USING "btree" ("upload_id");



CREATE INDEX "idx_conversation_uploads_department_id" ON "public"."conversation_uploads" USING "btree" ("department_id");



CREATE INDEX "idx_department_members_department_id" ON "public"."department_members" USING "btree" ("department_id");



CREATE INDEX "idx_department_members_user_id" ON "public"."department_members" USING "btree" ("user_id");



CREATE INDEX "idx_tasks_assigned_to" ON "public"."tasks" USING "btree" ("assigned_to");



CREATE INDEX "idx_tasks_department_id" ON "public"."tasks" USING "btree" ("department_id");



CREATE INDEX "idx_tasks_status" ON "public"."tasks" USING "btree" ("status");



CREATE INDEX "idx_wa_pending_drain" ON "public"."whatsapp_pending_messages" USING "btree" ("lock_key", "received_at");



CREATE INDEX "issue_escalation_links_issue_idx" ON "public"."issue_escalation_links" USING "btree" ("issue_id");



CREATE INDEX "issue_escalation_links_session_idx" ON "public"."issue_escalation_links" USING "btree" ("conversation_session_id");



CREATE INDEX "issue_escalation_links_status_idx" ON "public"."issue_escalation_links" USING "btree" ("issue_id", "status");



CREATE INDEX "issues_department_idx" ON "public"."issues" USING "btree" ("department_id");



CREATE INDEX "issues_status_idx" ON "public"."issues" USING "btree" ("status") WHERE ("status" <> 'resolved'::"text");



CREATE INDEX "knowledge_documents_created_at_idx" ON "public"."knowledge_documents" USING "btree" ("created_at" DESC);



CREATE INDEX "knowledge_documents_department_id_idx" ON "public"."knowledge_documents" USING "btree" ("department_id");



CREATE INDEX "knowledge_documents_store_idx" ON "public"."knowledge_documents" USING "btree" ("store");



CREATE UNIQUE INDEX "knowledge_gaps_open_topic_uniq" ON "public"."knowledge_gaps" USING "btree" ("normalized_topic") WHERE ("status" = 'open'::"text");



CREATE INDEX "knowledge_gaps_status_idx" ON "public"."knowledge_gaps" USING "btree" ("status", "times_seen" DESC, "last_seen_at" DESC);



CREATE UNIQUE INDEX "knowledge_suggestions_pending_dedup" ON "public"."knowledge_suggestions" USING "btree" ("dedup_key") WHERE ("status" = 'pending'::"text");



CREATE INDEX "knowledge_suggestions_status_created" ON "public"."knowledge_suggestions" USING "btree" ("status", "created_at" DESC);



CREATE UNIQUE INDEX "lisan_word_requests_open_word_uniq" ON "public"."lisan_word_requests" USING "btree" ("normalized_word") WHERE ("status" = 'open'::"text");



CREATE INDEX "lisan_word_requests_status_idx" ON "public"."lisan_word_requests" USING "btree" ("status", "times_seen" DESC, "last_seen_at" DESC);



CREATE INDEX "lisan_words_lisan_forms_idx" ON "public"."lisan_words" USING "gin" ("lisan_forms");



CREATE INDEX "lisan_words_lisan_forms_norm_idx" ON "public"."lisan_words" USING "gin" ("lisan_forms_norm");



CREATE INDEX "lisan_words_lisan_norm_trgm_idx" ON "public"."lisan_words" USING "gin" ("lisan_norm" "extensions"."gin_trgm_ops");



CREATE INDEX "lisan_words_meaning_terms_idx" ON "public"."lisan_words" USING "gin" ("meaning_terms");



CREATE INDEX "lisan_words_meaning_trgm_idx" ON "public"."lisan_words" USING "gin" ("meaning" "extensions"."gin_trgm_ops");



CREATE INDEX "lisan_words_norm_idx" ON "public"."lisan_words" USING "btree" ("norm");



CREATE INDEX "lisan_words_norm_trgm_idx" ON "public"."lisan_words" USING "gin" ("norm" "extensions"."gin_trgm_ops");



CREATE INDEX "lisan_words_skeleton_forms_idx" ON "public"."lisan_words" USING "gin" ("skeleton_forms");



CREATE INDEX "lisan_words_skeleton_idx" ON "public"."lisan_words" USING "btree" ("norm_skeleton");



CREATE INDEX "messages_direction_created_at_idx" ON "public"."messages" USING "btree" ("direction", "created_at" DESC);



CREATE INDEX "messages_phone_e164_created_at_idx" ON "public"."messages" USING "btree" ("phone_e164", "created_at" DESC);



CREATE INDEX "messages_phone_number_id_created_at_idx" ON "public"."messages" USING "btree" ("phone_number_id", "created_at" DESC);



CREATE INDEX "milestones_department_id_idx" ON "public"."milestones" USING "btree" ("department_id");



CREATE INDEX "milestones_status_idx" ON "public"."milestones" USING "btree" ("status");



CREATE INDEX "mumin_phone_links_mumin_idx" ON "public"."mumin_phone_links" USING "btree" ("mumin_id");



CREATE INDEX "mumin_phone_links_phone_idx" ON "public"."mumin_phone_links" USING "btree" ("phone_e164");



CREATE INDEX "mumineen_family_id_idx" ON "public"."mumineen" USING "btree" ("family_id");



CREATE INDEX "mumineen_hof_its_idx" ON "public"."mumineen" USING "btree" ("hof_its");



CREATE INDEX "mumineen_import_log_created_at_idx" ON "public"."mumineen_import_log" USING "btree" ("created_at" DESC);



CREATE INDEX "mumineen_is_adult_idx" ON "public"."mumineen" USING "btree" ("is_adult");



CREATE INDEX "mumineen_whatsapp_e164_idx" ON "public"."mumineen" USING "btree" ("whatsapp_e164");



CREATE UNIQUE INDEX "niyaz_event_config_day_id_key" ON "public"."niyaz_event_config" USING "btree" ("day_id");



CREATE INDEX "niyaz_family_headcount_family_idx" ON "public"."niyaz_family_headcount" USING "btree" ("family_id");



CREATE INDEX "niyaz_rsvp_family_idx" ON "public"."niyaz_rsvp" USING "btree" ("family_id");



CREATE INDEX "niyaz_rsvp_instance_idx" ON "public"."niyaz_rsvp" USING "btree" ("registration_instance_id");



CREATE INDEX "niyaz_rsvp_mumin_idx" ON "public"."niyaz_rsvp" USING "btree" ("mumin_id");



CREATE INDEX "niyaz_rsvp_prompts_phone_open_idx" ON "public"."niyaz_rsvp_prompts" USING "btree" ("phone_e164", "sent_at" DESC) WHERE ("consumed_at" IS NULL);



CREATE INDEX "parking_passes_family_id_idx" ON "public"."parking_passes" USING "btree" ("family_id");



CREATE INDEX "parking_passes_lot_id_idx" ON "public"."parking_passes" USING "btree" ("lot_id");



CREATE INDEX "quiz_answers_recipient_idx" ON "public"."quiz_answers" USING "btree" ("recipient_id");



CREATE INDEX "quiz_recipients_its_idx" ON "public"."quiz_recipients" USING "btree" ("its_number");



CREATE INDEX "quiz_recipients_quiz_idx" ON "public"."quiz_recipients" USING "btree" ("quiz_key");



CREATE UNIQUE INDEX "quiz_recipients_quiz_its_uniq" ON "public"."quiz_recipients" USING "btree" ("quiz_key", "its_number") WHERE ("its_number" IS NOT NULL);



CREATE INDEX "quiz_recipients_token_idx" ON "public"."quiz_recipients" USING "btree" ("token");



CREATE INDEX "registration_otps_edit_token_idx" ON "public"."registration_otps" USING "btree" ("edit_token");



CREATE INDEX "registration_otps_hof_its_idx" ON "public"."registration_otps" USING "btree" ("hof_its");



CREATE INDEX "relay_updates_published_date_idx" ON "public"."relay_updates" USING "btree" ("published", "date" DESC);



CREATE INDEX "religious_content_current_section_idx" ON "public"."religious_content" USING "btree" ("is_current", "section");



CREATE INDEX "religious_content_embedding_idx" ON "public"."religious_content" USING "ivfflat" ("embedding" "extensions"."vector_cosine_ops") WITH ("lists"='50');



CREATE INDEX "religious_ruling_flags_created_at_idx" ON "public"."religious_ruling_flags" USING "btree" ("created_at" DESC);



CREATE INDEX "religious_topics_majlis_idx" ON "public"."religious_topics" USING "btree" ("year_hijri", "majlis_number", "category");



CREATE INDEX "religious_topics_sort_order_idx" ON "public"."religious_topics" USING "btree" ("sort_order");



CREATE INDEX "religious_topics_status_idx" ON "public"."religious_topics" USING "btree" ("status");



CREATE UNIQUE INDEX "rsvp_registration_instance_day_meal_key" ON "public"."rsvp_registration_instance" USING "btree" ("event_date", "meal") WHERE (("event_date" IS NOT NULL) AND ("meal" IS NOT NULL));



CREATE INDEX "rsvp_registration_instance_event_date_idx" ON "public"."rsvp_registration_instance" USING "btree" ("event_date");



CREATE INDEX "rsvp_responses_family_latest_idx" ON "public"."rsvp_responses" USING "btree" ("registration_instance_id", "family_id", "submitted_at" DESC);



CREATE UNIQUE INDEX "rsvp_responses_instance_submitter_key" ON "public"."rsvp_responses" USING "btree" ("registration_instance_id", "submitted_by_mumin_id") WHERE ("submitted_by_mumin_id" IS NOT NULL);



CREATE INDEX "site_content_embedding_idx" ON "public"."site_content" USING "ivfflat" ("embedding" "extensions"."vector_cosine_ops") WITH ("lists"='50');



CREATE INDEX "site_content_is_current_section_idx" ON "public"."site_content" USING "btree" ("is_current", "section");



CREATE INDEX "survey_answers_area_date_idx" ON "public"."survey_answers" USING "btree" ("area", "event_date");



CREATE INDEX "survey_answers_form_section_idx" ON "public"."survey_answers" USING "btree" ("form_id", "section_id");



CREATE INDEX "survey_answers_recipient_idx" ON "public"."survey_answers" USING "btree" ("recipient_id");



CREATE INDEX "survey_exposures_question_idx" ON "public"."survey_question_exposures" USING "btree" ("question_id");



CREATE INDEX "survey_form_questions_form_idx" ON "public"."survey_form_questions" USING "btree" ("form_id");



CREATE INDEX "survey_forms_status_date_idx" ON "public"."survey_forms" USING "btree" ("status", "event_date");



CREATE INDEX "survey_questions_section_idx" ON "public"."survey_questions" USING "btree" ("section_id");



CREATE INDEX "survey_recipients_form_idx" ON "public"."survey_recipients" USING "btree" ("form_id");



CREATE INDEX "survey_recipients_mumin_date_idx" ON "public"."survey_recipients" USING "btree" ("mumin_id", "event_date");



CREATE INDEX "survey_recipients_token_idx" ON "public"."survey_recipients" USING "btree" ("token");



CREATE INDEX "tasks_archived_idx" ON "public"."tasks" USING "btree" ("archived");



CREATE INDEX "tasks_dept_status_priority_idx" ON "public"."tasks" USING "btree" ("department_id", "status", "priority" DESC);



CREATE INDEX "tasks_item_type_idx" ON "public"."tasks" USING "btree" ("item_type");



CREATE INDEX "tasks_milestone_id_idx" ON "public"."tasks" USING "btree" ("milestone_id");



CREATE INDEX "tasks_origin_idx" ON "public"."tasks" USING "btree" ("origin");



CREATE INDEX "tasks_priority_idx" ON "public"."tasks" USING "btree" ("priority");



CREATE INDEX "template_broadcast_recipients_broadcast_idx" ON "public"."template_broadcast_recipients" USING "btree" ("broadcast_id");



CREATE INDEX "template_broadcast_recipients_wamid_idx" ON "public"."template_broadcast_recipients" USING "btree" ("wa_message_id");



CREATE INDEX "template_broadcasts_started_idx" ON "public"."template_broadcasts" USING "btree" ("started_at" DESC);



CREATE INDEX "tool_audit_logs_tool_name_created_idx" ON "public"."tool_audit_logs" USING "btree" ("tool_name", "created_at" DESC);



CREATE INDEX "tool_audit_logs_user_id_created_at_idx" ON "public"."tool_audit_logs" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "transcript_function_calls_status_idx" ON "public"."transcript_function_calls" USING "btree" ("status");



CREATE INDEX "transcript_function_calls_upload_id_idx" ON "public"."transcript_function_calls" USING "btree" ("upload_id");



CREATE INDEX "unregistered_rsvps_instance_idx" ON "public"."unregistered_rsvps" USING "btree" ("registration_instance_id");



CREATE INDEX "unregistered_rsvps_phone_idx" ON "public"."unregistered_rsvps" USING "btree" ("phone_e164");



CREATE INDEX "whatsapp_interactive_responses_flow_token_idx" ON "public"."whatsapp_interactive_responses" USING "btree" ("flow_token");



CREATE INDEX "whatsapp_interactive_responses_phone_idx" ON "public"."whatsapp_interactive_responses" USING "btree" ("phone_e164");



CREATE UNIQUE INDEX "whatsapp_template_settings_waba_name_uniq" ON "public"."whatsapp_template_settings" USING "btree" (COALESCE("waba_id", ''::"text"), "template_name");



CREATE INDEX "whatsapp_undeliverable_suppressed_idx" ON "public"."whatsapp_undeliverable" USING "btree" ("suppressed") WHERE "suppressed";



CREATE INDEX "whatsapp_users_email_digest_idx" ON "public"."whatsapp_users" USING "btree" ("email_digest") WHERE (("email" IS NOT NULL) AND ("status" = 'active'::"text"));



CREATE UNIQUE INDEX "whatsapp_users_email_lower_key" ON "public"."whatsapp_users" USING "btree" ("lower"("email")) WHERE (("email" IS NOT NULL) AND ("email" <> ''::"text"));



CREATE UNIQUE INDEX "whatsapp_users_password_reset_token_hash_idx" ON "public"."whatsapp_users" USING "btree" ("password_reset_token_hash") WHERE ("password_reset_token_hash" IS NOT NULL);



CREATE OR REPLACE TRIGGER "broadcast_recipients_updated_at" BEFORE UPDATE ON "public"."broadcast_recipients" FOR EACH ROW EXECUTE FUNCTION "public"."set_broadcasts_updated_at"();



CREATE OR REPLACE TRIGGER "broadcasts_updated_at" BEFORE UPDATE ON "public"."broadcasts" FOR EACH ROW EXECUTE FUNCTION "public"."set_broadcasts_updated_at"();



CREATE OR REPLACE TRIGGER "department_daily_summaries_updated_at" BEFORE UPDATE ON "public"."department_daily_summaries" FOR EACH ROW EXECUTE FUNCTION "public"."set_department_daily_summaries_updated_at"();



CREATE OR REPLACE TRIGGER "department_prompt_config_updated_at" BEFORE UPDATE ON "public"."department_prompt_config" FOR EACH ROW EXECUTE FUNCTION "public"."set_department_prompt_config_updated_at"();



CREATE OR REPLACE TRIGGER "issues_updated_at" BEFORE UPDATE ON "public"."issues" FOR EACH ROW EXECUTE FUNCTION "public"."set_issues_updated_at"();



CREATE OR REPLACE TRIGGER "milestones_updated_at" BEFORE UPDATE ON "public"."milestones" FOR EACH ROW EXECUTE FUNCTION "public"."set_milestones_updated_at"();



CREATE OR REPLACE TRIGGER "niyaz_event_config_updated_at" BEFORE UPDATE ON "public"."niyaz_event_config" FOR EACH ROW EXECUTE FUNCTION "public"."set_niyaz_event_config_updated_at"();



CREATE OR REPLACE TRIGGER "niyaz_family_headcount_updated_at" BEFORE UPDATE ON "public"."niyaz_family_headcount" FOR EACH ROW EXECUTE FUNCTION "public"."set_niyaz_family_headcount_updated_at"();



CREATE OR REPLACE TRIGGER "niyaz_rsvp_updated_at" BEFORE UPDATE ON "public"."niyaz_rsvp" FOR EACH ROW EXECUTE FUNCTION "public"."set_niyaz_rsvp_updated_at"();



CREATE OR REPLACE TRIGGER "rsvp_registration_instance_updated_at" BEFORE UPDATE ON "public"."rsvp_registration_instance" FOR EACH ROW EXECUTE FUNCTION "public"."set_rsvp_registration_instance_updated_at"();



CREATE OR REPLACE TRIGGER "rsvp_responses_updated_at" BEFORE UPDATE ON "public"."rsvp_responses" FOR EACH ROW EXECUTE FUNCTION "public"."set_rsvp_responses_updated_at"();



CREATE OR REPLACE TRIGGER "set_whatsapp_users_updated_at" BEFORE UPDATE ON "public"."whatsapp_users" FOR EACH ROW EXECUTE FUNCTION "public"."set_whatsapp_users_updated_at"();



CREATE OR REPLACE TRIGGER "system_prompts_updated_at" BEFORE UPDATE ON "public"."system_prompts" FOR EACH ROW EXECUTE FUNCTION "public"."set_system_prompts_updated_at"();



CREATE OR REPLACE TRIGGER "tasks_updated_at" BEFORE UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."set_tasks_updated_at"();



CREATE OR REPLACE TRIGGER "unregistered_rsvps_updated_at" BEFORE UPDATE ON "public"."unregistered_rsvps" FOR EACH ROW EXECUTE FUNCTION "public"."set_unregistered_rsvps_updated_at"();



CREATE OR REPLACE TRIGGER "whatsapp_template_settings_updated_at" BEFORE UPDATE ON "public"."whatsapp_template_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_whatsapp_template_settings_updated_at"();



ALTER TABLE ONLY "public"."accommodation_hosts"
    ADD CONSTRAINT "accommodation_hosts_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "public"."accommodation_host_imports"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."accommodation_matches"
    ADD CONSTRAINT "accommodation_matches_guest_family_id_fkey" FOREIGN KEY ("guest_family_id") REFERENCES "public"."families"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."accommodation_matches"
    ADD CONSTRAINT "accommodation_matches_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "public"."accommodation_hosts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."broadcast_recipients"
    ADD CONSTRAINT "broadcast_recipients_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."broadcast_recipients"
    ADD CONSTRAINT "broadcast_recipients_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."broadcast_recipients"
    ADD CONSTRAINT "broadcast_recipients_mumin_id_fkey" FOREIGN KEY ("mumin_id") REFERENCES "public"."mumineen"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."committee_permissions"
    ADD CONSTRAINT "committee_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."whatsapp_users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_events"
    ADD CONSTRAINT "conversation_events_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."whatsapp_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversation_events"
    ADD CONSTRAINT "conversation_events_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_events"
    ADD CONSTRAINT "conversation_events_function_call_id_fkey" FOREIGN KEY ("function_call_id") REFERENCES "public"."transcript_function_calls"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversation_events"
    ADD CONSTRAINT "conversation_events_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversation_events"
    ADD CONSTRAINT "conversation_events_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "public"."whatsapp_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversation_events"
    ADD CONSTRAINT "conversation_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversation_events"
    ADD CONSTRAINT "conversation_events_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "public"."conversation_uploads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_sessions"
    ADD CONSTRAINT "conversation_sessions_escalation_assigned_to_fkey" FOREIGN KEY ("escalation_assigned_to") REFERENCES "public"."whatsapp_users"("id");



ALTER TABLE ONLY "public"."conversation_sessions"
    ADD CONSTRAINT "conversation_sessions_escalation_department_id_fkey" FOREIGN KEY ("escalation_department_id") REFERENCES "public"."departments"("id");



ALTER TABLE ONLY "public"."conversation_sessions"
    ADD CONSTRAINT "conversation_sessions_handling_mode_by_fkey" FOREIGN KEY ("handling_mode_by") REFERENCES "public"."whatsapp_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversation_sessions"
    ADD CONSTRAINT "conversation_sessions_linked_issue_id_fkey" FOREIGN KEY ("linked_issue_id") REFERENCES "public"."issues"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversation_sessions"
    ADD CONSTRAINT "conversation_sessions_linked_task_id_fkey" FOREIGN KEY ("linked_task_id") REFERENCES "public"."tasks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversation_sessions"
    ADD CONSTRAINT "conversation_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."whatsapp_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversation_upload_departments"
    ADD CONSTRAINT "conversation_upload_departments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_upload_departments"
    ADD CONSTRAINT "conversation_upload_departments_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "public"."conversation_uploads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_uploads"
    ADD CONSTRAINT "conversation_uploads_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_uploads"
    ADD CONSTRAINT "conversation_uploads_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."whatsapp_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."department_contacts"
    ADD CONSTRAINT "department_contacts_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."department_daily_summaries"
    ADD CONSTRAINT "department_daily_summaries_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."department_members"
    ADD CONSTRAINT "department_members_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."department_members"
    ADD CONSTRAINT "department_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."whatsapp_users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."department_prompt_config"
    ADD CONSTRAINT "department_prompt_config_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."department_prompt_config"
    ADD CONSTRAINT "department_prompt_config_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."whatsapp_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."escalation_activity_log"
    ADD CONSTRAINT "escalation_activity_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."whatsapp_users"("id");



ALTER TABLE ONLY "public"."escalation_activity_log"
    ADD CONSTRAINT "escalation_activity_log_conversation_session_id_fkey" FOREIGN KEY ("conversation_session_id") REFERENCES "public"."conversation_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."escalation_activity_log"
    ADD CONSTRAINT "escalation_activity_log_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."escalation_activity_log"
    ADD CONSTRAINT "escalation_activity_log_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."escalation_sla_config"
    ADD CONSTRAINT "escalation_sla_config_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."whatsapp_users"("id");



ALTER TABLE ONLY "public"."escalation_support_members"
    ADD CONSTRAINT "escalation_support_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."whatsapp_users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."faq_buckets"
    ADD CONSTRAINT "faq_buckets_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."rsvp_registration_instance"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."feedback_entries"
    ADD CONSTRAINT "feedback_entries_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."feedback_entries"
    ADD CONSTRAINT "feedback_entries_mumin_id_fkey" FOREIGN KEY ("mumin_id") REFERENCES "public"."mumineen"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_mumin_id_fkey" FOREIGN KEY ("mumin_id") REFERENCES "public"."mumineen"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."issue_escalation_links"
    ADD CONSTRAINT "issue_escalation_links_conversation_session_id_fkey" FOREIGN KEY ("conversation_session_id") REFERENCES "public"."conversation_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."issue_escalation_links"
    ADD CONSTRAINT "issue_escalation_links_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."issue_escalation_links"
    ADD CONSTRAINT "issue_escalation_links_linked_by_fkey" FOREIGN KEY ("linked_by") REFERENCES "public"."whatsapp_users"("id");



ALTER TABLE ONLY "public"."issue_escalation_links"
    ADD CONSTRAINT "issue_escalation_links_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."whatsapp_users"("id");



ALTER TABLE ONLY "public"."issues"
    ADD CONSTRAINT "issues_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."whatsapp_users"("id");



ALTER TABLE ONLY "public"."issues"
    ADD CONSTRAINT "issues_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."whatsapp_users"("id");



ALTER TABLE ONLY "public"."issues"
    ADD CONSTRAINT "issues_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id");



ALTER TABLE ONLY "public"."knowledge_documents"
    ADD CONSTRAINT "knowledge_documents_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."knowledge_documents"
    ADD CONSTRAINT "knowledge_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."whatsapp_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."knowledge_suggestions"
    ADD CONSTRAINT "knowledge_suggestions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."knowledge_suggestions"
    ADD CONSTRAINT "knowledge_suggestions_knowledge_document_id_fkey" FOREIGN KEY ("knowledge_document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."milestones"
    ADD CONSTRAINT "milestones_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."whatsapp_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."milestones"
    ADD CONSTRAINT "milestones_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mumin_phone_links"
    ADD CONSTRAINT "mumin_phone_links_mumin_id_fkey" FOREIGN KEY ("mumin_id") REFERENCES "public"."mumineen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mumineen"
    ADD CONSTRAINT "mumineen_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mumineen_import_log"
    ADD CONSTRAINT "mumineen_import_log_imported_by_user_id_fkey" FOREIGN KEY ("imported_by_user_id") REFERENCES "public"."whatsapp_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."niyaz_family_headcount"
    ADD CONSTRAINT "niyaz_family_headcount_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."niyaz_family_headcount"
    ADD CONSTRAINT "niyaz_family_headcount_registration_instance_id_fkey" FOREIGN KEY ("registration_instance_id") REFERENCES "public"."rsvp_registration_instance"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."niyaz_rsvp"
    ADD CONSTRAINT "niyaz_rsvp_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."niyaz_rsvp"
    ADD CONSTRAINT "niyaz_rsvp_mumin_id_fkey" FOREIGN KEY ("mumin_id") REFERENCES "public"."mumineen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."niyaz_rsvp_prompts"
    ADD CONSTRAINT "niyaz_rsvp_prompts_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."niyaz_rsvp"
    ADD CONSTRAINT "niyaz_rsvp_registration_instance_id_fkey" FOREIGN KEY ("registration_instance_id") REFERENCES "public"."rsvp_registration_instance"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."parking_passes"
    ADD CONSTRAINT "parking_passes_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."whatsapp_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."parking_passes"
    ADD CONSTRAINT "parking_passes_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."parking_passes"
    ADD CONSTRAINT "parking_passes_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "public"."parking_lots"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quiz_answers"
    ADD CONSTRAINT "quiz_answers_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "public"."quiz_recipients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quiz_recipients"
    ADD CONSTRAINT "quiz_recipients_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."quiz_recipients"
    ADD CONSTRAINT "quiz_recipients_mumin_id_fkey" FOREIGN KEY ("mumin_id") REFERENCES "public"."mumineen"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."relay_updates"
    ADD CONSTRAINT "relay_updates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."whatsapp_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."religious_monitors"
    ADD CONSTRAINT "religious_monitors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."whatsapp_users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rsvp_responses"
    ADD CONSTRAINT "rsvp_responses_campaign_id_fkey" FOREIGN KEY ("registration_instance_id") REFERENCES "public"."rsvp_registration_instance"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rsvp_responses"
    ADD CONSTRAINT "rsvp_responses_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rsvp_responses"
    ADD CONSTRAINT "rsvp_responses_mumin_id_fkey" FOREIGN KEY ("submitted_by_mumin_id") REFERENCES "public"."mumineen"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."survey_answers"
    ADD CONSTRAINT "survey_answers_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."survey_answers"
    ADD CONSTRAINT "survey_answers_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."survey_forms"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."survey_answers"
    ADD CONSTRAINT "survey_answers_mumin_id_fkey" FOREIGN KEY ("mumin_id") REFERENCES "public"."mumineen"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."survey_answers"
    ADD CONSTRAINT "survey_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."survey_questions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."survey_answers"
    ADD CONSTRAINT "survey_answers_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "public"."survey_recipients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."survey_answers"
    ADD CONSTRAINT "survey_answers_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "public"."survey_sections"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."survey_form_questions"
    ADD CONSTRAINT "survey_form_questions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."survey_forms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."survey_form_questions"
    ADD CONSTRAINT "survey_form_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."survey_questions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."survey_form_questions"
    ADD CONSTRAINT "survey_form_questions_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "public"."survey_sections"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."survey_forms"
    ADD CONSTRAINT "survey_forms_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."survey_groups"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."survey_question_exposures"
    ADD CONSTRAINT "survey_question_exposures_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."survey_forms"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."survey_question_exposures"
    ADD CONSTRAINT "survey_question_exposures_mumin_id_fkey" FOREIGN KEY ("mumin_id") REFERENCES "public"."mumineen"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."survey_question_exposures"
    ADD CONSTRAINT "survey_question_exposures_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."survey_questions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."survey_questions"
    ADD CONSTRAINT "survey_questions_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "public"."survey_sections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."survey_recipients"
    ADD CONSTRAINT "survey_recipients_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."survey_recipients"
    ADD CONSTRAINT "survey_recipients_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."survey_forms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."survey_recipients"
    ADD CONSTRAINT "survey_recipients_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."survey_groups"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."survey_recipients"
    ADD CONSTRAINT "survey_recipients_mumin_id_fkey" FOREIGN KEY ("mumin_id") REFERENCES "public"."mumineen"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."system_prompts"
    ADD CONSTRAINT "system_prompts_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."whatsapp_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."whatsapp_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."whatsapp_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."template_broadcast_recipients"
    ADD CONSTRAINT "template_broadcast_recipients_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "public"."template_broadcasts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."template_broadcast_recipients"
    ADD CONSTRAINT "template_broadcast_recipients_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."template_broadcasts"
    ADD CONSTRAINT "template_broadcasts_triggered_by_user_id_fkey" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."whatsapp_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tool_audit_logs"
    ADD CONSTRAINT "tool_audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."whatsapp_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transcript_function_calls"
    ADD CONSTRAINT "transcript_function_calls_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "public"."conversation_uploads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."unregistered_rsvps"
    ADD CONSTRAINT "unregistered_rsvps_registration_instance_id_fkey" FOREIGN KEY ("registration_instance_id") REFERENCES "public"."rsvp_registration_instance"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_undeliverable"
    ADD CONSTRAINT "whatsapp_undeliverable_cleared_by_fkey" FOREIGN KEY ("cleared_by") REFERENCES "public"."whatsapp_users"("id") ON DELETE SET NULL;



CREATE POLICY "Service role full access" ON "public"."accommodation_host_imports" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access" ON "public"."accommodation_hosts" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access" ON "public"."accommodation_matches" USING (true) WITH CHECK (true);



ALTER TABLE "public"."accommodation_host_imports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accommodation_hosts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accommodation_matches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."broadcast_recipients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."broadcasts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."committee_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conversation_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conversation_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conversation_upload_departments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conversation_uploads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cron_job_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."department_contacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."department_daily_summaries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."department_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."department_prompt_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."departments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."escalation_activity_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."escalation_sla_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."escalation_support_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."families" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feedback" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feedback_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."issue_escalation_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."issues" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."knowledge_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."knowledge_gaps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lisan_word_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lisan_words" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."milestones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mumin_phone_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mumineen" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."niyaz_event_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."niyaz_family_headcount" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."niyaz_rsvp" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."niyaz_rsvp_prompts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."parking_lots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."parking_passes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."quiz_answers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."quiz_recipients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."quizzes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."registration_otps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."relay_updates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."religious_content" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."religious_monitors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."religious_ruling_flags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."religious_topics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rsvp_registration_instance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rsvp_responses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."site_content" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."survey_answers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."survey_form_questions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."survey_forms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."survey_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."survey_question_exposures" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."survey_questions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."survey_recipients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."survey_sections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."system_prompts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."template_broadcast_recipients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."template_broadcasts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tool_audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transcript_function_calls" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."unregistered_rsvps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."webinars" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "webinars_public_read" ON "public"."webinars" FOR SELECT USING (("active" = true));



ALTER TABLE "public"."whatsapp_inbound_locks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."whatsapp_interactive_responses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."whatsapp_pending_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."whatsapp_template_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."whatsapp_undeliverable" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."whatsapp_users" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";





















































































































































































































































































































































































































































































































































































































GRANT ALL ON FUNCTION "public"."adjust_broadcast_counters"("p_broadcast_id" "uuid", "p_sent_delta" integer, "p_failed_delta" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."adjust_broadcast_counters"("p_broadcast_id" "uuid", "p_sent_delta" integer, "p_failed_delta" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."adjust_broadcast_counters"("p_broadcast_id" "uuid", "p_sent_delta" integer, "p_failed_delta" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."bump_broadcast_counter"("p_broadcast_id" "uuid", "p_field" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."bump_broadcast_counter"("p_broadcast_id" "uuid", "p_field" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bump_broadcast_counter"("p_broadcast_id" "uuid", "p_field" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_broadcast_recipients"("p_batch_size" integer, "p_stale_seconds" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_broadcast_recipients"("p_batch_size" integer, "p_stale_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_broadcast_recipients"("p_batch_size" integer, "p_stale_seconds" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."dashboard_conversation_stats"("p_since" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."dashboard_conversation_stats"("p_since" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."dashboard_conversation_stats"("p_since" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."escalation_status_from_stage"("stage" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."escalation_status_from_stage"("stage" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."escalation_status_from_stage"("stage" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."finalize_mumineen_import"("p_its" "text"[], "p_hof" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."finalize_mumineen_import"("p_its" "text"[], "p_hof" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."finalize_mumineen_import"("p_its" "text"[], "p_hof" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."finalize_mumineen_import"("p_its" "text"[], "p_hof" "text"[], "p_deactivate_missing" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."finalize_mumineen_import"("p_its" "text"[], "p_hof" "text"[], "p_deactivate_missing" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."finalize_mumineen_import"("p_its" "text"[], "p_hof" "text"[], "p_deactivate_missing" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_mumineen_columns"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_mumineen_columns"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_mumineen_columns"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_registration_status"("p_phone" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_registration_status"("p_phone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_registration_status"("p_phone" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_permissions"("p_phone" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_permissions"("p_phone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_permissions"("p_phone" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_permissions_by_id"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_permissions_by_id"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_permissions_by_id"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."lisan_script_norm"("s" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."lisan_script_norm"("s" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lisan_script_norm"("s" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."match_lisan_by_meaning"("query_text" "text", "match_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."match_lisan_by_meaning"("query_text" "text", "match_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."match_lisan_by_meaning"("query_text" "text", "match_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."match_lisan_words"("query_norm" "text", "match_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."match_lisan_words"("query_norm" "text", "match_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."match_lisan_words"("query_norm" "text", "match_count" integer) TO "service_role";









GRANT ALL ON FUNCTION "public"."niyaz_event_breakdown"("p_instance_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."niyaz_event_breakdown"("p_instance_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."niyaz_event_breakdown"("p_instance_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."niyaz_event_cross_meal"("p_instance_id" "uuid", "p_confirmed_only" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."niyaz_event_cross_meal"("p_instance_id" "uuid", "p_confirmed_only" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."niyaz_event_cross_meal"("p_instance_id" "uuid", "p_confirmed_only" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."niyaz_event_family_grid"("p_instance_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."niyaz_event_family_grid"("p_instance_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."niyaz_event_family_grid"("p_instance_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."niyaz_event_individual_grid"("p_instance_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."niyaz_event_individual_grid"("p_instance_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."niyaz_event_individual_grid"("p_instance_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."niyaz_event_tallies_min"() TO "anon";
GRANT ALL ON FUNCTION "public"."niyaz_event_tallies_min"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."niyaz_event_tallies_min"() TO "service_role";



GRANT ALL ON FUNCTION "public"."record_whatsapp_undeliverable"("p_phone" "text", "p_error_code" integer, "p_threshold" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."record_whatsapp_undeliverable"("p_phone" "text", "p_error_code" integer, "p_threshold" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_whatsapp_undeliverable"("p_phone" "text", "p_error_code" integer, "p_threshold" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."seed_family_niyaz_rsvp"("p_family_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."seed_family_niyaz_rsvp"("p_family_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."seed_family_niyaz_rsvp"("p_family_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_broadcasts_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_broadcasts_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_broadcasts_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_department_daily_summaries_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_department_daily_summaries_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_department_daily_summaries_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_department_prompt_config_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_department_prompt_config_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_department_prompt_config_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_issues_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_issues_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_issues_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_milestones_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_milestones_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_milestones_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_niyaz_event_config_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_niyaz_event_config_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_niyaz_event_config_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_niyaz_family_headcount_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_niyaz_family_headcount_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_niyaz_family_headcount_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_niyaz_rsvp_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_niyaz_rsvp_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_niyaz_rsvp_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_rsvp_registration_instance_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_rsvp_registration_instance_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_rsvp_registration_instance_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_rsvp_responses_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_rsvp_responses_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_rsvp_responses_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_system_prompts_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_system_prompts_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_system_prompts_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_tasks_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_tasks_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_tasks_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_unregistered_rsvps_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_unregistered_rsvps_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_unregistered_rsvps_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_whatsapp_template_settings_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_whatsapp_template_settings_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_whatsapp_template_settings_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_whatsapp_users_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_whatsapp_users_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_whatsapp_users_updated_at"() TO "service_role";






























GRANT ALL ON TABLE "public"."accommodation_host_imports" TO "anon";
GRANT ALL ON TABLE "public"."accommodation_host_imports" TO "authenticated";
GRANT ALL ON TABLE "public"."accommodation_host_imports" TO "service_role";



GRANT ALL ON TABLE "public"."accommodation_hosts" TO "anon";
GRANT ALL ON TABLE "public"."accommodation_hosts" TO "authenticated";
GRANT ALL ON TABLE "public"."accommodation_hosts" TO "service_role";



GRANT ALL ON TABLE "public"."accommodation_matches" TO "anon";
GRANT ALL ON TABLE "public"."accommodation_matches" TO "authenticated";
GRANT ALL ON TABLE "public"."accommodation_matches" TO "service_role";



GRANT ALL ON TABLE "public"."app_settings" TO "anon";
GRANT ALL ON TABLE "public"."app_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."app_settings" TO "service_role";



GRANT ALL ON TABLE "public"."broadcast_recipients" TO "anon";
GRANT ALL ON TABLE "public"."broadcast_recipients" TO "authenticated";
GRANT ALL ON TABLE "public"."broadcast_recipients" TO "service_role";



GRANT ALL ON TABLE "public"."broadcasts" TO "anon";
GRANT ALL ON TABLE "public"."broadcasts" TO "authenticated";
GRANT ALL ON TABLE "public"."broadcasts" TO "service_role";



GRANT ALL ON TABLE "public"."committee_permissions" TO "anon";
GRANT ALL ON TABLE "public"."committee_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."committee_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."conversation_events" TO "anon";
GRANT ALL ON TABLE "public"."conversation_events" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_events" TO "service_role";



GRANT ALL ON TABLE "public"."conversation_sessions" TO "anon";
GRANT ALL ON TABLE "public"."conversation_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."conversation_upload_departments" TO "anon";
GRANT ALL ON TABLE "public"."conversation_upload_departments" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_upload_departments" TO "service_role";



GRANT ALL ON TABLE "public"."conversation_uploads" TO "anon";
GRANT ALL ON TABLE "public"."conversation_uploads" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_uploads" TO "service_role";



GRANT ALL ON TABLE "public"."cron_job_logs" TO "anon";
GRANT ALL ON TABLE "public"."cron_job_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."cron_job_logs" TO "service_role";



GRANT ALL ON TABLE "public"."department_contacts" TO "anon";
GRANT ALL ON TABLE "public"."department_contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."department_contacts" TO "service_role";



GRANT ALL ON TABLE "public"."department_daily_summaries" TO "anon";
GRANT ALL ON TABLE "public"."department_daily_summaries" TO "authenticated";
GRANT ALL ON TABLE "public"."department_daily_summaries" TO "service_role";



GRANT ALL ON TABLE "public"."department_members" TO "anon";
GRANT ALL ON TABLE "public"."department_members" TO "authenticated";
GRANT ALL ON TABLE "public"."department_members" TO "service_role";



GRANT ALL ON TABLE "public"."department_prompt_config" TO "anon";
GRANT ALL ON TABLE "public"."department_prompt_config" TO "authenticated";
GRANT ALL ON TABLE "public"."department_prompt_config" TO "service_role";



GRANT ALL ON TABLE "public"."departments" TO "anon";
GRANT ALL ON TABLE "public"."departments" TO "authenticated";
GRANT ALL ON TABLE "public"."departments" TO "service_role";



GRANT ALL ON TABLE "public"."escalation_activity_log" TO "anon";
GRANT ALL ON TABLE "public"."escalation_activity_log" TO "authenticated";
GRANT ALL ON TABLE "public"."escalation_activity_log" TO "service_role";



GRANT ALL ON TABLE "public"."escalation_sla_config" TO "anon";
GRANT ALL ON TABLE "public"."escalation_sla_config" TO "authenticated";
GRANT ALL ON TABLE "public"."escalation_sla_config" TO "service_role";



GRANT ALL ON TABLE "public"."escalation_support_members" TO "anon";
GRANT ALL ON TABLE "public"."escalation_support_members" TO "authenticated";
GRANT ALL ON TABLE "public"."escalation_support_members" TO "service_role";



GRANT ALL ON TABLE "public"."families" TO "anon";
GRANT ALL ON TABLE "public"."families" TO "authenticated";
GRANT ALL ON TABLE "public"."families" TO "service_role";



GRANT ALL ON TABLE "public"."faq_buckets" TO "anon";
GRANT ALL ON TABLE "public"."faq_buckets" TO "authenticated";
GRANT ALL ON TABLE "public"."faq_buckets" TO "service_role";



GRANT ALL ON TABLE "public"."feedback" TO "anon";
GRANT ALL ON TABLE "public"."feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."feedback" TO "service_role";



GRANT ALL ON TABLE "public"."feedback_entries" TO "anon";
GRANT ALL ON TABLE "public"."feedback_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."feedback_entries" TO "service_role";



GRANT ALL ON TABLE "public"."issue_escalation_links" TO "anon";
GRANT ALL ON TABLE "public"."issue_escalation_links" TO "authenticated";
GRANT ALL ON TABLE "public"."issue_escalation_links" TO "service_role";



GRANT ALL ON TABLE "public"."issues" TO "anon";
GRANT ALL ON TABLE "public"."issues" TO "authenticated";
GRANT ALL ON TABLE "public"."issues" TO "service_role";



GRANT ALL ON SEQUENCE "public"."issues_issue_number_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."issues_issue_number_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."issues_issue_number_seq" TO "service_role";



GRANT ALL ON TABLE "public"."knowledge_documents" TO "anon";
GRANT ALL ON TABLE "public"."knowledge_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."knowledge_documents" TO "service_role";



GRANT ALL ON TABLE "public"."knowledge_gaps" TO "anon";
GRANT ALL ON TABLE "public"."knowledge_gaps" TO "authenticated";
GRANT ALL ON TABLE "public"."knowledge_gaps" TO "service_role";



GRANT ALL ON TABLE "public"."knowledge_suggestions" TO "anon";
GRANT ALL ON TABLE "public"."knowledge_suggestions" TO "authenticated";
GRANT ALL ON TABLE "public"."knowledge_suggestions" TO "service_role";



GRANT ALL ON TABLE "public"."lisan_word_requests" TO "anon";
GRANT ALL ON TABLE "public"."lisan_word_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."lisan_word_requests" TO "service_role";



GRANT ALL ON TABLE "public"."lisan_words" TO "anon";
GRANT ALL ON TABLE "public"."lisan_words" TO "authenticated";
GRANT ALL ON TABLE "public"."lisan_words" TO "service_role";



GRANT ALL ON SEQUENCE "public"."lisan_words_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."lisan_words_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."lisan_words_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."milestones" TO "anon";
GRANT ALL ON TABLE "public"."milestones" TO "authenticated";
GRANT ALL ON TABLE "public"."milestones" TO "service_role";



GRANT ALL ON TABLE "public"."mumin_phone_links" TO "anon";
GRANT ALL ON TABLE "public"."mumin_phone_links" TO "authenticated";
GRANT ALL ON TABLE "public"."mumin_phone_links" TO "service_role";



GRANT ALL ON TABLE "public"."mumineen" TO "anon";
GRANT ALL ON TABLE "public"."mumineen" TO "authenticated";
GRANT ALL ON TABLE "public"."mumineen" TO "service_role";



GRANT ALL ON TABLE "public"."mumineen_import_log" TO "anon";
GRANT ALL ON TABLE "public"."mumineen_import_log" TO "authenticated";
GRANT ALL ON TABLE "public"."mumineen_import_log" TO "service_role";



GRANT ALL ON TABLE "public"."niyaz_event_config" TO "anon";
GRANT ALL ON TABLE "public"."niyaz_event_config" TO "authenticated";
GRANT ALL ON TABLE "public"."niyaz_event_config" TO "service_role";



GRANT ALL ON SEQUENCE "public"."niyaz_event_config_day_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."niyaz_event_config_day_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."niyaz_event_config_day_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."niyaz_rsvp" TO "anon";
GRANT ALL ON TABLE "public"."niyaz_rsvp" TO "authenticated";
GRANT ALL ON TABLE "public"."niyaz_rsvp" TO "service_role";



GRANT ALL ON TABLE "public"."rsvp_registration_instance" TO "anon";
GRANT ALL ON TABLE "public"."rsvp_registration_instance" TO "authenticated";
GRANT ALL ON TABLE "public"."rsvp_registration_instance" TO "service_role";



GRANT ALL ON TABLE "public"."niyaz_event_tallies" TO "anon";
GRANT ALL ON TABLE "public"."niyaz_event_tallies" TO "authenticated";
GRANT ALL ON TABLE "public"."niyaz_event_tallies" TO "service_role";



GRANT ALL ON TABLE "public"."niyaz_family_headcount" TO "anon";
GRANT ALL ON TABLE "public"."niyaz_family_headcount" TO "authenticated";
GRANT ALL ON TABLE "public"."niyaz_family_headcount" TO "service_role";



GRANT ALL ON TABLE "public"."niyaz_rsvp_backup_20260616" TO "anon";
GRANT ALL ON TABLE "public"."niyaz_rsvp_backup_20260616" TO "authenticated";
GRANT ALL ON TABLE "public"."niyaz_rsvp_backup_20260616" TO "service_role";



GRANT ALL ON TABLE "public"."niyaz_rsvp_backup_jun20_24" TO "anon";
GRANT ALL ON TABLE "public"."niyaz_rsvp_backup_jun20_24" TO "authenticated";
GRANT ALL ON TABLE "public"."niyaz_rsvp_backup_jun20_24" TO "service_role";



GRANT ALL ON TABLE "public"."niyaz_rsvp_prompts" TO "anon";
GRANT ALL ON TABLE "public"."niyaz_rsvp_prompts" TO "authenticated";
GRANT ALL ON TABLE "public"."niyaz_rsvp_prompts" TO "service_role";



GRANT ALL ON TABLE "public"."niyaz_rsvp_reg_backup_20260616" TO "anon";
GRANT ALL ON TABLE "public"."niyaz_rsvp_reg_backup_20260616" TO "authenticated";
GRANT ALL ON TABLE "public"."niyaz_rsvp_reg_backup_20260616" TO "service_role";



GRANT ALL ON TABLE "public"."parking_lots" TO "anon";
GRANT ALL ON TABLE "public"."parking_lots" TO "authenticated";
GRANT ALL ON TABLE "public"."parking_lots" TO "service_role";



GRANT ALL ON TABLE "public"."parking_passes" TO "anon";
GRANT ALL ON TABLE "public"."parking_passes" TO "authenticated";
GRANT ALL ON TABLE "public"."parking_passes" TO "service_role";



GRANT ALL ON TABLE "public"."phone_message_stats" TO "anon";
GRANT ALL ON TABLE "public"."phone_message_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."phone_message_stats" TO "service_role";



GRANT ALL ON TABLE "public"."phone_template_sends" TO "anon";
GRANT ALL ON TABLE "public"."phone_template_sends" TO "authenticated";
GRANT ALL ON TABLE "public"."phone_template_sends" TO "service_role";



GRANT ALL ON TABLE "public"."tool_audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."tool_audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."tool_audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."phone_tool_usage" TO "anon";
GRANT ALL ON TABLE "public"."phone_tool_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."phone_tool_usage" TO "service_role";



GRANT ALL ON TABLE "public"."quiz_answers" TO "anon";
GRANT ALL ON TABLE "public"."quiz_answers" TO "authenticated";
GRANT ALL ON TABLE "public"."quiz_answers" TO "service_role";



GRANT ALL ON TABLE "public"."quiz_recipients" TO "anon";
GRANT ALL ON TABLE "public"."quiz_recipients" TO "authenticated";
GRANT ALL ON TABLE "public"."quiz_recipients" TO "service_role";



GRANT ALL ON TABLE "public"."quizzes" TO "anon";
GRANT ALL ON TABLE "public"."quizzes" TO "authenticated";
GRANT ALL ON TABLE "public"."quizzes" TO "service_role";



GRANT ALL ON TABLE "public"."registration_otps" TO "anon";
GRANT ALL ON TABLE "public"."registration_otps" TO "authenticated";
GRANT ALL ON TABLE "public"."registration_otps" TO "service_role";



GRANT ALL ON TABLE "public"."relay_updates" TO "anon";
GRANT ALL ON TABLE "public"."relay_updates" TO "authenticated";
GRANT ALL ON TABLE "public"."relay_updates" TO "service_role";



GRANT ALL ON TABLE "public"."religious_content" TO "anon";
GRANT ALL ON TABLE "public"."religious_content" TO "authenticated";
GRANT ALL ON TABLE "public"."religious_content" TO "service_role";



GRANT ALL ON SEQUENCE "public"."religious_content_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."religious_content_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."religious_content_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."religious_monitors" TO "anon";
GRANT ALL ON TABLE "public"."religious_monitors" TO "authenticated";
GRANT ALL ON TABLE "public"."religious_monitors" TO "service_role";



GRANT ALL ON TABLE "public"."religious_ruling_flags" TO "anon";
GRANT ALL ON TABLE "public"."religious_ruling_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."religious_ruling_flags" TO "service_role";



GRANT ALL ON TABLE "public"."religious_topics" TO "anon";
GRANT ALL ON TABLE "public"."religious_topics" TO "authenticated";
GRANT ALL ON TABLE "public"."religious_topics" TO "service_role";



GRANT ALL ON TABLE "public"."rsvp_responses" TO "anon";
GRANT ALL ON TABLE "public"."rsvp_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."rsvp_responses" TO "service_role";



GRANT ALL ON TABLE "public"."site_content" TO "anon";
GRANT ALL ON TABLE "public"."site_content" TO "authenticated";
GRANT ALL ON TABLE "public"."site_content" TO "service_role";



GRANT ALL ON SEQUENCE "public"."site_content_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."site_content_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."site_content_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."survey_answers" TO "anon";
GRANT ALL ON TABLE "public"."survey_answers" TO "authenticated";
GRANT ALL ON TABLE "public"."survey_answers" TO "service_role";



GRANT ALL ON TABLE "public"."survey_form_questions" TO "anon";
GRANT ALL ON TABLE "public"."survey_form_questions" TO "authenticated";
GRANT ALL ON TABLE "public"."survey_form_questions" TO "service_role";



GRANT ALL ON TABLE "public"."survey_forms" TO "anon";
GRANT ALL ON TABLE "public"."survey_forms" TO "authenticated";
GRANT ALL ON TABLE "public"."survey_forms" TO "service_role";



GRANT ALL ON TABLE "public"."survey_groups" TO "anon";
GRANT ALL ON TABLE "public"."survey_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."survey_groups" TO "service_role";



GRANT ALL ON TABLE "public"."survey_question_exposures" TO "anon";
GRANT ALL ON TABLE "public"."survey_question_exposures" TO "authenticated";
GRANT ALL ON TABLE "public"."survey_question_exposures" TO "service_role";



GRANT ALL ON TABLE "public"."survey_questions" TO "anon";
GRANT ALL ON TABLE "public"."survey_questions" TO "authenticated";
GRANT ALL ON TABLE "public"."survey_questions" TO "service_role";



GRANT ALL ON TABLE "public"."survey_recipients" TO "anon";
GRANT ALL ON TABLE "public"."survey_recipients" TO "authenticated";
GRANT ALL ON TABLE "public"."survey_recipients" TO "service_role";



GRANT ALL ON TABLE "public"."survey_sections" TO "anon";
GRANT ALL ON TABLE "public"."survey_sections" TO "authenticated";
GRANT ALL ON TABLE "public"."survey_sections" TO "service_role";



GRANT ALL ON TABLE "public"."system_prompts" TO "anon";
GRANT ALL ON TABLE "public"."system_prompts" TO "authenticated";
GRANT ALL ON TABLE "public"."system_prompts" TO "service_role";



GRANT ALL ON TABLE "public"."tasks" TO "anon";
GRANT ALL ON TABLE "public"."tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."tasks" TO "service_role";



GRANT ALL ON TABLE "public"."template_broadcast_recipients" TO "anon";
GRANT ALL ON TABLE "public"."template_broadcast_recipients" TO "authenticated";
GRANT ALL ON TABLE "public"."template_broadcast_recipients" TO "service_role";



GRANT ALL ON TABLE "public"."template_broadcasts" TO "anon";
GRANT ALL ON TABLE "public"."template_broadcasts" TO "authenticated";
GRANT ALL ON TABLE "public"."template_broadcasts" TO "service_role";



GRANT ALL ON TABLE "public"."transcript_function_calls" TO "anon";
GRANT ALL ON TABLE "public"."transcript_function_calls" TO "authenticated";
GRANT ALL ON TABLE "public"."transcript_function_calls" TO "service_role";



GRANT ALL ON TABLE "public"."unregistered_rsvps" TO "anon";
GRANT ALL ON TABLE "public"."unregistered_rsvps" TO "authenticated";
GRANT ALL ON TABLE "public"."unregistered_rsvps" TO "service_role";



GRANT ALL ON TABLE "public"."unregistered_rsvps_backup_20260616" TO "anon";
GRANT ALL ON TABLE "public"."unregistered_rsvps_backup_20260616" TO "authenticated";
GRANT ALL ON TABLE "public"."unregistered_rsvps_backup_20260616" TO "service_role";



GRANT ALL ON TABLE "public"."webinars" TO "anon";
GRANT ALL ON TABLE "public"."webinars" TO "authenticated";
GRANT ALL ON TABLE "public"."webinars" TO "service_role";



GRANT ALL ON SEQUENCE "public"."webinars_seq_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."webinars_seq_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."webinars_seq_seq" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_inbound_locks" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_inbound_locks" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_inbound_locks" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_interactive_responses" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_interactive_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_interactive_responses" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_pending_messages" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_pending_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_pending_messages" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_template_settings" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_template_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_template_settings" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_undeliverable" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_undeliverable" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_undeliverable" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_users" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_users" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_users" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































