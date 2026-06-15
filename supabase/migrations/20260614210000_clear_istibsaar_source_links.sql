-- The seeded majlis cells were auto-stamped with a placeholder source_url pointing at the
-- talabulilm istibsaar SEARCH page (and a "Istibsaar — …" source_label). Those aren't real article
-- links, so we stopped generating them; clear the ones already in the table so they disappear from
-- the Content grid / Needs-translation panel. Real per-block source links (anything else) are left
-- untouched; editors still set those manually.

update public.religious_topics
set source_url = null,
    source_label = null
where source_url like '%talabulilm.com/istibsaar%';
