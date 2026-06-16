-- Curate the survey databank to exactly 4 meaningful, non-redundant questions per section:
-- retire overlapping questions (soft-delete) and add distinct new ones. Runs after the original
-- seed (20260616000100). Idempotent-ish: the retire is keyed by exact text; the adds are skipped
-- if a question with that text already exists.

update public.survey_questions set active = false, updated_at = now()
where active and text in (
  'Volunteers were courteous, respectful, and easily identifiable when assistance was needed.',
  'Was it easy to find help when you needed it?',
  'Did you receive all the information you needed?',
  'Was the information received useful and timely?',
  'Did the venue and infrastructure allow you to focus on waaz/majlis without inconvenience?',
  'How would you rate crowd movement and wayfinding overall?',
  'Was the audio clear and at a comfortable volume?',
  'Were washroom facilities adequate (water temperature, space/privacy, namazi chakhris, garbage bins)?',
  'Did the transport arrangements and parking facilities help you arrive and leave with ease?',
  'Did you receive timely assistance when needed?',
  'Any additional comments?'
);

do $$
declare
  qual_opts jsonb := '[{"label":"Excellent"},{"label":"Good"},{"label":"Fair"},{"label":"Poor"}]';
  qual_neg  jsonb := '["Fair","Poor"]';
  yesno_neg jsonb := '["No"]';
  rows jsonb := '[
    {"s":"overall","t":"Were the daily timings (waaz, namaz, mawaid) well-coordinated?","ty":"choice","g":true},
    {"s":"overall","t":"How welcomed and cared for did you feel overall?","ty":"choice","g":true},
    {"s":"communication","t":"Were schedule changes or updates communicated to you in time?","ty":"yesno","g":true},
    {"s":"communication","t":"How would you rate the WhatsApp / helpline updates you received?","ty":"choice","g":true},
    {"s":"venue_seating","t":"Were the gents / ladies areas well-organized and adequately sized?","ty":"choice"},
    {"s":"crowd_flow","t":"How smooth was leaving the venue after waaz / majlis?","ty":"choice"},
    {"s":"av_relay","t":"Was the relay well synchronized (audio and video in sync, no major lag)?","ty":"yesno"},
    {"s":"cleanliness","t":"Were there enough washrooms available near your area?","ty":"yesno"},
    {"s":"transport","t":"How easy was it to find parking when you arrived?","ty":"choice"},
    {"s":"transport","t":"How was the flow when leaving the parking area after waaz?","ty":"choice"},
    {"s":"safety","t":"Did you know what to do or where to go in case of an emergency?","ty":"yesno"},
    {"s":"helpdesk","t":"Was your question or issue resolved in a reasonable time?","ty":"choice"},
    {"s":"helpdesk","t":"Did you know how to reach the help desk / helpline when needed?","ty":"yesno"},
    {"s":"rahat","t":"Was Rahat seating conveniently located (good view, easy access to exits / washrooms)?","ty":"choice"},
    {"s":"rahat","t":"Was wheelchair / mobility support available when you needed it?","ty":"yesno"},
    {"s":"medical","t":"Was the wait time to be seen at Mahal-us-Shifa reasonable?","ty":"choice"},
    {"s":"atfaal","t":"Were the Atfaal area volunteers attentive and helpful?","ty":"choice"},
    {"s":"reception","t":"Was the reception / pickup coordination (timing, communication) smooth?","ty":"choice"},
    {"s":"accommodation","t":"Was your host / accommodation team responsive to your needs?","ty":"choice"},
    {"s":"final","t":"How likely are you to attend the Chicago Relay Center again next year? (1 = not likely, 10 = very likely)","ty":"scale10","g":true}
  ]';
  rec jsonb; v_section uuid; v_next int; v_opts jsonb; v_neg jsonb;
begin
  for rec in select * from jsonb_array_elements(rows) loop
    select id into v_section from public.survey_sections where key = (rec->>'s');
    if v_section is null then continue; end if;
    if exists (select 1 from public.survey_questions where section_id = v_section and text = (rec->>'t')) then continue; end if;
    select coalesce(max(sort_order),0)+1 into v_next from public.survey_questions where section_id = v_section;
    v_opts := null; v_neg := null;
    if rec->>'ty' = 'choice' then v_opts := qual_opts; v_neg := qual_neg; end if;
    if rec->>'ty' = 'yesno' then v_neg := yesno_neg; end if;
    insert into public.survey_questions (section_id, text, type, options, negative_values, polarity, is_general, sort_order)
    values (v_section, rec->>'t', rec->>'ty', v_opts, v_neg, 'positive', coalesce((rec->>'g')::boolean,false), v_next);
  end loop;
end $$;
