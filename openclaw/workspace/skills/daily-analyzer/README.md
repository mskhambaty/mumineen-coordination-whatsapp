# Claw Daily Analyzer

Turns captured WhatsApp group messages into per-group **daily markdown logs**. Reads
the ingester's JSONL capture files (read-only), slices by Chicago-timezone day, and
runs one of two analyses based on the group's `type` in `groups.json`.

- **Internal** groups → summary, decisions made, actions needed (with owner), actions completed.
- **External** group (guest social) → filters out chatter, keeps Ashara-relevant
  content, and clusters the questions guests are actually asking.

Standalone Python (run on cron or by hand). A thin `SKILL.md` lets OpenClaw invoke it
from chat, but the script is the source of truth and runs fine without OpenClaw.

## What it does NOT do

- Never modifies the capture files (read-only source of truth).
- No identity table — uses whatever `sender_name`/phone is in the JSONL ("unknown" if absent).
- No DB — writes markdown files. (Structured/wiki output can come later.)

## Setup

```bash
mkdir -p ~/.openclaw/workspace/skills/daily-analyzer
cd ~/.openclaw/workspace/skills/daily-analyzer
# copy in: daily_analyzer.py, requirements.txt, SKILL.md,
#         internal_prompt.md, external_prompt.md
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
```

The two `*_prompt.md` files MUST sit next to `daily_analyzer.py` — the script loads
them by path at startup and exits fast with a clear error if either is missing.

### Secrets / config: `.env`

The script auto-loads `.env` from its own directory at startup using a tiny stdlib
parser (no third-party dep — the script runs on any Python install). A single command
works from any cwd — no `source`, no wrapper, no venv activation needed for env vars.
Start from the template:

```bash
cp .env.example .env
chmod 600 .env
echo .env >> .gitignore   # never commit the key
$EDITOR .env              # fill in ANALYZER_API_KEY (and adjust paths if needed)
```

A complete `.env` looks like:

```ini
ANALYZER_API_KEY=sk-your-ollama-cloud-key
CAPTURE_DIR=/home/asc/claw-message-ingester/captures
GROUPS_FILE=/home/asc/claw-message-ingester/groups.json
# Optional:
# ANALYZER_API_BASE=https://ollama.com/v1
# ANALYZER_MODEL=gemini-3-flash-preview
```

Putting `CAPTURE_DIR` and `GROUPS_FILE` here means you don't have to pass
`--captures-dir` / `--groups-file` on every run. Real env vars and CLI flags still
override `.env` if you ever need a one-off.

### Config reference

| Env                | Default                   | Purpose                                        |
|--------------------|---------------------------|------------------------------------------------|
| `ANALYZER_MODEL`   | `gemini-3-flash-preview`  | Model id. **Change here only** — nothing downstream cares. |
| `ANALYZER_API_BASE`| `https://ollama.com/v1`   | OpenAI-compatible base URL. **VERIFY for your Ollama Cloud.** |
| `ANALYZER_API_KEY` | _(empty)_                 | Your Ollama Cloud key. Required unless `ANALYZER_API_BASE` points at localhost. |
| `CAPTURE_DIR`      | `./captures`              | The ingester's capture directory. Can also be passed as `--captures-dir`. |
| `GROUPS_FILE`      | `./groups.json`           | The ingester's group map. Can also be passed as `--groups-file`. |
| `LOG_DIR`          | `./logs`                  | Where daily logs are written.                  |

The script **fails fast at startup** if `ANALYZER_API_KEY` is empty against a non-local
`ANALYZER_API_BASE` — one clear error instead of one 401 per group.

Precedence: **CLI flag > real env var > `.env` > default**. So if you ever want to
override the `.env` value for one run, just prefix the command (`CAPTURE_DIR=... python
...`) or pass the flag.

## Group flags (`groups.json`)

Add a `type` to each group entry. Anything missing it **defaults to `internal`** (safer —
external analysis on an internal group would discard real decisions as "chatter"):

```json
{
  "120363...@g.us": { "department": "Site/Construction", "wa_subject": "...", "type": "internal" },
  "120363...@g.us": { "department": "Guest Social",      "wa_subject": "...", "type": "external" }
}
```

## Usage

Call the venv's Python by absolute path — no shell activation, no `source .env`, no
wrapper. The script auto-loads `.env` next to itself:

```bash
# cron default: all groups, yesterday
~/.openclaw/workspace/skills/daily-analyzer/.venv/bin/python ~/.openclaw/workspace/skills/daily-analyzer/daily_analyzer.py

# ad-hoc
~/.openclaw/workspace/skills/daily-analyzer/.venv/bin/python ~/.openclaw/workspace/skills/daily-analyzer/daily_analyzer.py --group all --date yesterday
~/.openclaw/workspace/skills/daily-analyzer/.venv/bin/python ~/.openclaw/workspace/skills/daily-analyzer/daily_analyzer.py --group site --date today
~/.openclaw/workspace/skills/daily-analyzer/.venv/bin/python ~/.openclaw/workspace/skills/daily-analyzer/daily_analyzer.py --group "Site/Construction" --date 2026-06-05

# one-off override of the captures/groups paths (without editing .env)
~/.openclaw/workspace/skills/daily-analyzer/.venv/bin/python ~/.openclaw/workspace/skills/daily-analyzer/daily_analyzer.py \
    --captures-dir /some/other/captures \
    --groups-file  /some/other/groups.json
```

If you're already `cd`'d into the analyzer dir and want shorter commands, you can drop
the path prefix:

```bash
cd ~/.openclaw/workspace/skills/daily-analyzer
./.venv/bin/python daily_analyzer.py --group site --date today
```

### Arguments

- `--group`: `all` (default), a department name (substring match), or a group JID.
- `--date`: `yesterday` (default), `today`, or `YYYY-MM-DD`. All boundaries are America/Chicago.
- `--captures-dir`: path to the ingester's captures directory. Overrides `CAPTURE_DIR`.
- `--groups-file`: path to the ingester's `groups.json`. Overrides `GROUPS_FILE`. In the
  ingester layout it sits next to `captures/`, e.g.
  `/home/asc/claw-message-ingester/groups.json`.

Precedence: CLI flag > env var > `.env` > default.

Output: `logs/<groupId>-<groupName>/<YYYY-MM-DD>.md` — e.g.
`logs/120363410038900760-site-construction/2026-06-05.md`. The numeric prefix is the
durable group ID; the suffix is the slugified `department` (or `wa_subject` if no
department is set). Idempotent — re-running a date overwrites it. Re-running `today`
mid-day analyzes messages so far; the nightly run finalizes it.

## Cron (daily batch)

No wrapper needed — cron just calls the venv's Python directly. The script picks up
`ANALYZER_API_KEY`, `CAPTURE_DIR`, and `GROUPS_FILE` from `.env` automatically:

```cron
0 3 * * *  /home/asc/.openclaw/workspace/skills/daily-analyzer/.venv/bin/python /home/asc/.openclaw/workspace/skills/daily-analyzer/daily_analyzer.py >> /home/asc/.openclaw/workspace/skills/daily-analyzer/cron.log 2>&1
```

That runs yesterday for all groups every morning at 3am Chicago. The key is never on
the command line (so it doesn't appear in `ps` or crontab listings) — it stays inside
`.env` with `chmod 600`.

(When this becomes a systemd timer, the unit can use `WorkingDirectory=` plus the same
absolute-path command — or `EnvironmentFile=/home/asc/.openclaw/workspace/skills/daily-analyzer/.env` to let
systemd handle the secret loading instead of the script's inline parser. Both work.)

## How it works

1. Resolve `--group` → group JIDs (via `groups.json`) and `--date` → a Chicago date.
2. For each group: read its capture JSONL, keep only messages whose Chicago-day == target,
   **dedup by `wa_msg_id`**, **drop `is_bot` messages**.
3. Build a transcript, send to the model with the internal or external system prompt
   (selected by the group's `type`), requesting strict JSON.
4. Render the JSON to markdown and write the daily log.

The file read is isolated in `read_day_messages()` so a byte-offset cursor can replace
the full-file read later if capture files get large. For v1 it reads the whole file and
filters by day (fast enough at event scale).

## Editing the prompts

The two system prompts live in `internal_prompt.md` and `external_prompt.md` (loaded at
startup). Edit them in place — no code change needed.

- **`internal_prompt.md`** drives committee groups. Output shape: `summary`, `decisions`,
  `actions_needed` (with `owner`), `actions_completed`, `blockers`, `recurring_themes`.
- **`external_prompt.md`** drives guest social groups. Output shape: `summary`,
  `questions` (clustered, counted by unique senders), `pain_points`, plus
  `relevant_message_count` / `ignored_chatter_count`. The topic taxonomy lives inside the
  prompt — add/remove topics there.

Both prompts include a PII rule: ITS numbers / phone numbers / emails never appear in
structured fields; names are restricted to `owner` attributions (internal) or verbatim
`examples` (external). If you change the JSON shape, also update the corresponding
renderer (`render_internal` / `render_external`) so the new fields surface in the
markdown output.

## Gotchas

- **`ANALYZER_API_BASE` must match your Ollama Cloud's OpenAI-compatible endpoint.** The
  default is a best guess — verify it and the key, or the model call fails.
- **Capture files may have duplicate lines** (reconnect replays); the script dedups by
  `wa_msg_id`. Lines without an id aren't deduped (rare).
- **`is_bot` messages are excluded** from analysis (your own outbound notifications).
- **Day boundaries are America/Chicago**, not UTC — an 11pm-Chicago message stays on the
  correct local day.
- **High-volume days** are sent in one model call. If a single group's day ever exceeds the
  model's context, that group's analysis will error (logged in its daily log); chunking can
  be added then. Not expected at event scale.
- **Model output that isn't valid JSON** is caught: the day's log records the parse error
  and the raw output for debugging instead of crashing the batch.

## Files

| File                 | Purpose                                                  |
|----------------------|----------------------------------------------------------|
| `daily_analyzer.py`  | The analysis script (all the logic).                     |
| `internal_prompt.md` | System prompt for `type: "internal"` (committee) groups. Edit to retune. |
| `external_prompt.md` | System prompt for `type: "external"` (guest social) groups. Topic taxonomy lives here. |
| `requirements.txt`   | `openai` client. `.env` loading is stdlib-only (no extra dep). |
| `SKILL.md`           | Thin OpenClaw wrapper to invoke the script from chat.    |
| `.env.example`       | Template — copy to `.env`, fill in, `chmod 600`.         |
| `.env`               | Local secrets/config — gitignored, `chmod 600`. Not committed. |
