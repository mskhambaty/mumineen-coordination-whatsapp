-- Seed the survey databank from the PMO "Ashara 1448H Mumineen Feedback" survey, plus starter
-- target groups. Idempotent: sections/questions keyed by stable slugs (on conflict do nothing);
-- groups by unique name. QUAL = Excellent/Good/Fair/Poor; AGREE = Strongly agree..Strongly disagree.

-- ── Sections ──────────────────────────────────────────────────────────────────────────────
insert into public.survey_sections (key, title, description, area, is_general, sort_order) values
  ('overall',        'Overall Experience',            'General impression of organization and volunteer support.', 'general',           true,  10),
  ('communication',  'Communication & Announcements', 'Information, announcements, and communication channels.',    'general',           true,  20),
  ('venue_seating',  'Venue, Seating & Comfort',      'The space, seating, signage, and overall comfort.',          'seating',           false, 30),
  ('crowd_flow',     'Crowd Flow & Entry',            'Movement, wayfinding, and entry scanning.',                  'flow',              false, 40),
  ('av_relay',       'Audio / Video Relay',           'Quality of the live audio/video relay during waaz.',         'audio_video',       false, 50),
  ('mawaid',         'Mawaid (Food & Dining)',        'Jaman quality, serving, seating, and Sabeel-e-Husain.',      'mawaid',            false, 60),
  ('cleanliness',    'Cleanliness & Washrooms',       'Premises cleanliness and washroom facilities.',              'general',           false, 70),
  ('transport',      'Transport & Parking',           'Arrival, parking, and the journey to the entrance.',         'parking_transport', false, 80),
  ('safety',         'Safety & Security',             'Your sense of safety and emergency preparedness.',           'flow',              false, 90),
  ('helpdesk',       'Help Desk & Follow-up',         'Helpline, information desks, and any follow-up contact.',     'general',           false, 100),
  ('rahat',          'Rahat & Accessibility Support', 'Experience with Rahat / wheelchair / elderly assistance.',   'seating',           false, 110),
  ('medical',        'Medical (Mahal-us-Shifa)',      'Your experience with the medical facility.',                 'general',           false, 120),
  ('atfaal',         'Atfaal Care (Childcare)',       'Your experience with the childcare / Atfaal facilities.',    'general',           false, 130),
  ('reception',      'Guest Services — Reception',    'Airport/venue reception and welcome kit for mehmaan.',       'accommodation',     false, 140),
  ('accommodation',  'Accommodation (Utaro)',         'Your lodging and amenities provided during your stay.',      'accommodation',     false, 150),
  ('final',          'Final Thoughts',                'Your overall rating and suggestions.',                       'general',           true,  160)
on conflict (key) do nothing;

-- ── Questions ─────────────────────────────────────────────────────────────────────────────
-- Helper: insert a question by section key. QUAL/AGREE options + their negatives are inlined.
do $$
declare
  qual_opts jsonb := '[{"label":"Excellent"},{"label":"Good"},{"label":"Fair"},{"label":"Poor"}]';
  qual_neg  jsonb := '["Fair","Poor"]';
  agree_opts jsonb := '[{"label":"Strongly agree"},{"label":"Agree"},{"label":"Disagree"},{"label":"Strongly disagree"}]';
  agree_neg jsonb := '["Disagree","Strongly disagree"]';
  yesno_neg jsonb := '["No"]';
  rows jsonb := '[
    {"s":"overall","t":"Overall, how well-organized was the event?","ty":"choice","o":"qual","so":1},
    {"s":"overall","t":"How would you rate volunteer (Khidmat Guzar) support during Ashara?","ty":"choice","o":"qual","so":2},
    {"s":"overall","t":"Volunteers were courteous, respectful, and easily identifiable when assistance was needed.","ty":"choice","o":"agree","so":3,"g":true},
    {"s":"overall","t":"Was it easy to find help when you needed it?","ty":"yesno","so":4,"g":true},

    {"s":"communication","t":"Did you receive all the information you needed?","ty":"yesno","so":1,"g":true},
    {"s":"communication","t":"Was the information received useful and timely?","ty":"choice","o":"qual","so":2},
    {"s":"communication","t":"Communication channels were easy to access.","ty":"choice","o":"agree","so":3},
    {"s":"communication","t":"Were announcements (schedule, logistics) clear and helpful?","ty":"choice","o":"qual","so":4},

    {"s":"venue_seating","t":"Did the venue and infrastructure allow you to focus on waaz/majlis without inconvenience?","ty":"yesno","so":1},
    {"s":"venue_seating","t":"Were temperature and lighting comfortable?","ty":"choice","o":"qual","so":2},
    {"s":"venue_seating","t":"Was seating adequate, comfortable, and in good condition (including bichaat/jazam areas)?","ty":"choice","o":"qual","so":3},
    {"s":"venue_seating","t":"Were there enough clear signages to help you navigate?","ty":"yesno","so":4},

    {"s":"crowd_flow","t":"How would you rate crowd movement and wayfinding overall?","ty":"choice","o":"qual","so":1},
    {"s":"crowd_flow","t":"Did you experience crowding or long waits entering/exiting?","ty":"choice","o":"crowding","so":2,"pol":"negative"},
    {"s":"crowd_flow","t":"Was the entry pass scanning process quick and smooth?","ty":"yesno","so":3},
    {"s":"crowd_flow","t":"What single flow or wayfinding improvement would help most?","ty":"text","so":4},

    {"s":"av_relay","t":"Clarity of the Audio/Video relay (1 = very poor, 10 = excellent):","ty":"scale10","so":1},
    {"s":"av_relay","t":"Was the audio clear and at a comfortable volume?","ty":"yesno","so":2},
    {"s":"av_relay","t":"Were the screens/TVs clearly visible from your seating?","ty":"yesno","so":3},
    {"s":"av_relay","t":"Did you experience any AV disruptions during waaz?","ty":"yesno","so":4,"pol":"negative"},

    {"s":"mawaid","t":"How was the Jaman taste and temperature?","ty":"choice","o":"qual","so":1},
    {"s":"mawaid","t":"Was the Jaman quantity appropriate?","ty":"choice","o":"quantity","so":2},
    {"s":"mawaid","t":"Was the serving process smooth and timely, and seating easy to find?","ty":"choice","o":"qual","so":3},
    {"s":"mawaid","t":"Sabeel-e-Husain — was it easily accessible with fresh beverages at the right temperature?","ty":"yesno","so":4},

    {"s":"cleanliness","t":"Were the premises clean and free of foul smells (bukhoor done)?","ty":"yesno","so":1},
    {"s":"cleanliness","t":"Washroom / bathroom cleanliness (1 = very poor, 10 = spotless):","ty":"scale10","so":2},
    {"s":"cleanliness","t":"Were washroom facilities adequate (water temperature, space/privacy, namazi chakhris, garbage bins)?","ty":"choice","o":"qual","so":3},
    {"s":"cleanliness","t":"What was your typical wait time at the washroom?","ty":"choice","o":"wait","so":4,"pol":"negative"},

    {"s":"transport","t":"Did the transport arrangements and parking facilities help you arrive and leave with ease?","ty":"choice","o":"qual","so":1},
    {"s":"transport","t":"How smooth was the journey from parking or drop-off to the entrance?","ty":"choice","o":"qual","so":2},
    {"s":"transport","t":"Any issue with transport/parking flow we should fix?","ty":"text","so":3},

    {"s":"safety","t":"Did you feel safe at the venue?","ty":"yesno","so":1,"g":true},
    {"s":"safety","t":"Were security personnel courteous and helpful?","ty":"choice","o":"qual","so":2},
    {"s":"safety","t":"Were emergency exits clearly marked?","ty":"yesno","so":3},

    {"s":"helpdesk","t":"Did the helpline and information desks function effectively?","ty":"yesno","so":1},
    {"s":"helpdesk","t":"Were helpdesk staff knowledgeable and courteous?","ty":"choice","o":"qual","so":2},

    {"s":"rahat","t":"Did you receive timely assistance when needed?","ty":"yesno","so":1},
    {"s":"rahat","t":"Were Rahat facilities (wheelchair, seating) accessible?","ty":"choice","o":"qual","so":2},
    {"s":"rahat","t":"Were Rahat Khidmat Guzars attentive and helpful?","ty":"choice","o":"qual","so":3},

    {"s":"medical","t":"How was your experience with your Mahal-us-Shifa visit?","ty":"choice","o":"qual","so":1},
    {"s":"medical","t":"Were you able to receive the medication prescribed?","ty":"yesno","so":2},
    {"s":"medical","t":"Were you satisfied with the diagnosis?","ty":"yesno","so":3},

    {"s":"atfaal","t":"Did you have appropriate room for seating and accessible feeding/diaper-changing space?","ty":"yesno","so":1},
    {"s":"atfaal","t":"How was your overall experience with the Atfaal support?","ty":"choice","o":"qual","so":2},
    {"s":"atfaal","t":"Did you feel your child was safe and well cared for?","ty":"yesno","so":3},

    {"s":"reception","t":"Did you feel warmly welcomed upon arrival?","ty":"yesno","so":1},
    {"s":"reception","t":"How was your reception by the airport / venue reception team?","ty":"choice","o":"qual","so":2},
    {"s":"reception","t":"How would you rate your welcome kit?","ty":"choice","o":"qual","so":3},

    {"s":"accommodation","t":"Was your accommodation clean and comfortable?","ty":"choice","o":"qual","so":1},
    {"s":"accommodation","t":"Were the amenities (bedding, toiletries) adequate?","ty":"yesno","so":2},
    {"s":"accommodation","t":"Was the accommodation convenient for getting to and from the relay centre?","ty":"choice","o":"qual","so":3},

    {"s":"final","t":"Overall satisfaction with your Ashara experience (1 = poor, 10 = excellent):","ty":"scale10","so":1,"g":true},
    {"s":"final","t":"What was the best part of your experience?","ty":"text","so":2,"g":true},
    {"s":"final","t":"The single most important improvement you would suggest:","ty":"text","so":3,"g":true},
    {"s":"final","t":"Any additional comments?","ty":"text","so":4,"g":true}
  ]';
  rec jsonb;
  v_section uuid;
  v_opts jsonb;
  v_neg jsonb;
begin
  for rec in select * from jsonb_array_elements(rows) loop
    select id into v_section from public.survey_sections where key = (rec->>'s');
    if v_section is null then continue; end if;

    -- options + negatives by named option-set
    v_opts := null; v_neg := null;
    case rec->>'o'
      when 'qual' then v_opts := qual_opts; v_neg := qual_neg;
      when 'agree' then v_opts := agree_opts; v_neg := agree_neg;
      when 'crowding' then
        v_opts := '[{"label":"No, never"},{"label":"Occasionally"},{"label":"Often"},{"label":"Almost always"}]';
        v_neg := '["Often","Almost always"]';
      when 'quantity' then
        v_opts := '[{"label":"Just right"},{"label":"Too little"},{"label":"Too much"}]';
        v_neg := '["Too little","Too much"]';
      when 'wait' then
        v_opts := '[{"label":"Under 5 min"},{"label":"5-10 min"},{"label":"10-20 min"},{"label":"Over 20 min"}]';
        v_neg := '["10-20 min","Over 20 min"]';
      else v_opts := null;
    end case;
    -- For yes/no, the reason box triggers on the "problem" answer: "Yes" when the question is
    -- negatively phrased (No = good), otherwise "No".
    if rec->>'ty' = 'yesno' then v_neg := case when coalesce(rec->>'pol','positive') = 'negative' then '["Yes"]'::jsonb else yesno_neg end; end if;

    insert into public.survey_questions
      (section_id, text, type, options, negative_values, polarity, is_general, sort_order)
    values (
      v_section,
      rec->>'t',
      rec->>'ty',
      v_opts,
      v_neg,
      coalesce(rec->>'pol', 'positive'),
      coalesce((rec->>'g')::boolean, false),
      coalesce((rec->>'so')::int, 0)
    );
  end loop;
end $$;

-- ── Starter target groups (audience-filter RuleGroup JSON) ──────────────────────────────────
insert into public.survey_groups (name, description, rules, area_focus) values
  ('All attending',        'Every attending mumin with a WhatsApp number.',
     '{"combinator":"and","rules":[{"field":"not_attending","operator":"=","value":false},{"field":"has_whatsapp","operator":"=","value":true}]}', null),
  ('Rahat / accessibility','Mumineen flagged for rahat seating or wheelchair.',
     '{"combinator":"and","rules":[{"field":"not_attending","operator":"=","value":false},{"combinator":"or","rules":[{"field":"rahat_seating","operator":"=","value":true},{"field":"wheelchair","operator":"=","value":true}]}]}', 'seating'),
  ('Mehmaan — rental car', 'Visiting mehmaan whose family rented a car.',
     '{"combinator":"and","rules":[{"field":"local_mehman","operator":"in","value":["Mehman"]},{"field":"transport_mode","operator":"in","value":["rental"]}]}', 'parking_transport'),
  ('Local Chicago',        'Local (non-mehmaan) attendees.',
     '{"combinator":"and","rules":[{"field":"local_mehman","operator":"in","value":["Local"]},{"field":"not_attending","operator":"=","value":false}]}', null),
  ('VIP / category',       'Mumineen carrying a roster category (VIP tier).',
     '{"combinator":"and","rules":[{"field":"category","operator":"notNull"}]}', null),
  ('Accommodation — utaro','Mehmaan staying in utaro / host families.',
     '{"combinator":"and","rules":[{"field":"acc_type","operator":"in","value":["utaro"]}]}', 'accommodation')
on conflict (name) do nothing;
