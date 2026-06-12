-- Server-side aggregation for the admin dashboard. Avoids the PostgREST max_rows
-- cap (1000) that was silently truncating conversation/message counts.

create or replace function public.dashboard_conversation_stats(p_since timestamptz)
returns json as $$
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
$$ language sql stable;
