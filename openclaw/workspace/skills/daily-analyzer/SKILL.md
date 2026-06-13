---
name: daily-analyzer
description: >
  Generate the daily analysis log for one or all WhatsApp groups. Use when asked to
  summarize a group's day, pull decisions/actions/blockers from an internal group, or
  surface the questions and pain points guests raised in a social group. Produces a
  markdown daily log.
metadata: { "openclaw": { "emoji": "📊" } }
---

# Daily Analyzer

Runs the standalone analysis script over captured WhatsApp messages and returns the
resulting daily log. The script does the work; this skill just invokes it.

## When to use

- "Summarize the Site group today" → one group, today
- "Run the daily analysis" / "analyze yesterday" → all groups, yesterday
- "What did guests ask yesterday?" / "what are guests struggling with?" → an external
  (guest social) group, yesterday
- "What's blocked in the Logistics group?" → one internal group, today/yesterday
- "Analyze the social group for the past week" → external group(s), `--days 7`
- "Last 3 days of the Site group" → one group, `--date yesterday --days 3`

## Workflow: check before you run

Logs are deterministic and idempotent. Before invoking the analyzer for a specific
group on a specific date, **always check whether the log already exists** — re-running
costs a model call and produces the same file. The log lives at:

```
/home/asc/.openclaw/workspace/skills/daily-analyzer/logs/<groupFolder>/<YYYY-MM-DD>.md
```

`<groupFolder>` is `<numericJid>-<slugifiedName>`, e.g. `120363410038900760-tazyeen`.
If you don't know the exact slug, list candidates:

```bash
ls /home/asc/.openclaw/workspace/skills/daily-analyzer/logs/ | grep -i <group-name>
```

Then check for the dated file:

```bash
ls /home/asc/.openclaw/workspace/skills/daily-analyzer/logs/<groupFolder>/2026-06-11.md 2>/dev/null
```

### Decision tree

- **File exists** → Read it and present its contents. Do NOT re-run the analyzer.
  The log is the source of truth.
- **File does NOT exist** → Tell the user *"June 11th hasn't been analyzed yet —
  running the analyzer now"*, invoke the script with that specific date, then read the
  resulting file and present it.
- **Group folder doesn't exist at all** → Either the group has no captures for that
  date OR the group name didn't match. Run the analyzer once; if the script prints
  `no messages`, tell the user that day was silent for that group. If it prints
  `No groups matched`, the name didn't resolve — fall back to reading `groups.json`
  to disambiguate.

### Multi-day requests

For prompts like "past week", check each day individually. Present any existing
logs immediately, then run the analyzer **only for the missing dates** — pass each
missing date as a separate `--date <YYYY-MM-DD>` invocation (or use a single
`--days N` call if every day in the range is missing). Tell the user which days
were already cached vs. freshly analyzed.

## How to run

Single command, absolute paths — no shell activation, no `source`, no wrapper.
The script auto-loads `.env` (Ollama Cloud key + captures/groups paths) from its own
directory:

```
/home/asc/.openclaw/workspace/skills/daily-analyzer/.venv/bin/python /home/asc/.openclaw/workspace/skills/daily-analyzer/daily_analyzer.py --group <GROUP> --date <DATE>
```

That's the whole invocation. Forward whatever `--group` / `--date` values the user
asked for; omit them to default to all groups for yesterday.

### Arguments

- `--group`: `all` (default), or a substring matched against the department label,
  `wa_subject`, JID, numeric id, or the `<id>-<slug>` folder name. So `site`,
  `"Site/Construction"`, `120363410038900760`, `120363410038900760@g.us`, and
  `120363410038900760-site-construction` all resolve to the same group.
- `--date`: `yesterday` (default), `today`, or `YYYY-MM-DD`. The END date of the range
  when combined with `--days`. All boundaries are America/Chicago.
- `--days N`: Number of consecutive days to analyze, ending on `--date`. Default `1`
  (single day). Writes one log per day per group — there is NO combined weekly digest
  file. Use this for prompts like "past week" (`--days 7`), "last 3 days" (`--days 3`),
  etc.

Both captures and groups paths come from `.env` — only pass `--captures-dir` /
`--groups-file` for a one-off override:

```
/home/asc/.openclaw/workspace/skills/daily-analyzer/.venv/bin/python /home/asc/.openclaw/workspace/skills/daily-analyzer/daily_analyzer.py \
    --captures-dir /some/other/captures \
    --groups-file  /some/other/groups.json \
    --group <GROUP> --date <DATE>
```

Precedence: CLI flag > real env var > `.env` > default.

## Resolving "the social group" / "the guest group" / "the X group"

When the user names a group abstractly ("the social group", "the guest group", "the
external group", or by `type` rather than by name), you need to find which JID(s) that
refers to. The path to `groups.json` is whatever `GROUPS_FILE` in the analyzer's `.env`
points at — on this host it's typically `/home/asc/.openclaw/workspace/skills/claw-ingester/groups.json`,
but read the `.env` to be sure.

Each entry looks like:

```json
"120363...@g.us": { "department": "Guest Social", "wa_subject": "...", "type": "external" }
```

Mappings to look for:

- **"social" / "guest" / "guests" / "external" group** → entries where `type == "external"`.
- **"committee" / "internal" / "the team" group** → entries where `type == "internal"` (or
  no `type` field, which defaults to internal).
- **A specific department** → match the user's phrase against `department` or
  `wa_subject` (case-insensitive substring).

If multiple groups match (e.g. two external groups exist), run the analyzer once per
matched group and surface the results separately. If none match, tell the user and show
the available `department` labels so they can disambiguate.

When you have the right JID(s), pass each as `--group <jid>` (the JID always matches
exactly). Do NOT try to be clever with substring filters — use the JID.

## Where logs land

```
/home/asc/.openclaw/workspace/skills/daily-analyzer/logs/<groupId>-<groupName>/<YYYY-MM-DD>.md
```

For example: `logs/120363410038900760-site-construction/2026-06-05.md`. The numeric
prefix is the durable group ID; the suffix is the slugified `department` (or
`wa_subject` if no department is set).

For a single group, read that one file. For `--group all`, the script prints one status
line per group like `120363...-site-construction: ok (47 msgs, internal)` or
`...: ANALYSIS FAILED (<reason>)` — read the files for the groups the user asked about,
and surface failures.

## Output shape

What you'll find in each log depends on the group's `type` in `groups.json`:

- **Internal groups** (committee coordination): summary, decisions, actions needed
  (with owner), actions completed, blockers / open concerns, recurring themes.
- **External groups** (guest social): summary, clustered questions (counted by unique
  senders, not message count), pain points by topic, and relevant-vs-chatter message
  counts.

If a group's `type` is missing in `groups.json`, the analyzer treats it as `internal`
(safer default — running external analysis on an internal group throws away real
decisions as chatter).

## Notes

- The script reads the ingester's capture files READ-ONLY and never modifies them.
- It is independent of OpenClaw — if this skill or the gateway misbehaves, the same
  command still runs fine from a shell or cron. This skill is only a convenience trigger.
- Model, API key, and the captures/groups paths all live in `.env` next to the script.
  The script auto-loads it at startup (tiny stdlib parser, no third-party dep), so
  this skill never needs to source it, set env vars, or know secrets.
- System prompts live in `internal_prompt.md` and `external_prompt.md` next to the
  script. Editing those changes what the analyzer extracts — no code change needed.

## Worked examples

**"Summary for the social group for June 11th"**

1. Read `groups.json`, find entry where `type == "external"` → suppose it's
   `120363...@g.us`, folder `120363...-guest-social`.
2. Check if the log exists:
   ```bash
   ls /home/asc/.openclaw/workspace/skills/daily-analyzer/logs/120363...-guest-social/2026-06-11.md
   ```
3. **If it exists** → read the file and present it. Done.
4. **If it doesn't exist** → reply *"June 11th hasn't been analyzed yet — running
   now"*, then:
   ```
   .../.venv/bin/python .../daily_analyzer.py --group 120363...@g.us --date 2026-06-11
   ```
   Then read the just-written file and present it.

**"Analyze the social group for the past week"**

1. Resolve to the external group JID via `groups.json` (as above).
2. For each of the last 7 dates (yesterday → 6 days before), check whether
   `logs/<folder>/<date>.md` already exists.
3. Tell the user something like *"4 of the 7 days are already analyzed; running the
   missing 3 now"*. Then invoke the script with `--date <missing-date>` per missing
   day (or a single `--days 7` call if none of them exist yet).
4. Read all 7 files in chronological order and present a per-day rundown.

**"Last 3 days of the Site group"**

Same pattern — check each of the 3 dates, run only the missing ones, then read all 3
files.

**"What did committee groups decide today?"**

1. From `groups.json`, find all entries where `type != "external"` (or unset).
2. For each: check if today's log exists; run the analyzer for any missing groups.
3. Read each internal log and present the decisions / actions / blockers sections.

> VERIFY against your OpenClaw build's skill format: how a SKILL.md authorizes
> command execution and how the agent passes arguments can differ by version. The
> command above is the source of truth; adjust this wrapper to match your build.
