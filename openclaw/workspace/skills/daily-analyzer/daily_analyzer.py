#!/usr/bin/env python3
"""
daily_analyzer.py — turn a day's captured WhatsApp group messages into a daily log.

Reads the ingester's JSONL capture files (READ-ONLY — never modifies them), slices
by Chicago-timezone day, dedups by wa_msg_id, drops bot messages, and runs either
INTERNAL or EXTERNAL analysis depending on the group's `type` in groups.json.
Writes logs/<group>/<YYYY-MM-DD>.md (idempotent — re-running a date overwrites it).

Usage:
  python daily_analyzer.py                                  # all groups, yesterday (cron default)
  python daily_analyzer.py --group all --date yesterday
  python daily_analyzer.py --group site --date today        # ad-hoc, one group
  python daily_analyzer.py --group "Site/Construction" --date 2026-06-05
  python daily_analyzer.py --group social --days 7          # past week ending yesterday
  python daily_analyzer.py \
      --captures-dir /home/asc/claw-message-ingester/captures \
      --groups-file  /home/asc/claw-message-ingester/groups.json

Config is loaded from .env sitting next to this script (tiny inline parser, no
third-party dep). Real environment variables still win over .env, and CLI flags
still win over both.

Env (all optional; defaults shown):
  ANALYZER_MODEL     gemini-3-flash-preview   # model id, change here only
  ANALYZER_API_BASE  https://ollama.com/v1    # OpenAI-compatible base URL (VERIFY for your Ollama Cloud)
  ANALYZER_API_KEY   (none)                   # your Ollama Cloud key
  CAPTURE_DIR        ./captures               # the ingester's capture dir (override with --captures-dir)
  GROUPS_FILE        ./groups.json            # the ingester's group map (override with --groups-file)
  LOG_DIR            ./logs                   # where daily logs are written

Precedence for paths: CLI flag > env var > .env > default.
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta, date
from pathlib import Path
from zoneinfo import ZoneInfo

# Tiny .env loader — stdlib only. Avoids a python-dotenv dep so the script runs on
# any Python install without needing a venv or system package. Real env vars win
# (`k not in os.environ`), so shell/CLI overrides still take precedence.
# Handles KEY=VALUE, comments, blank lines, and basic quoting. Does NOT handle
# multi-line values or variable expansion — if you ever need those, swap this for
# `python-dotenv` and `load_dotenv()`.
def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


# Absolute path so cwd doesn't matter (cron, OpenClaw skill, ad-hoc — all work).
_load_env_file(Path(__file__).resolve().parent / ".env")

# ── Config (change the model here only; nothing downstream cares) ────────────
MODEL = os.environ.get("ANALYZER_MODEL", "gemini-3-flash-preview")
API_BASE = os.environ.get("ANALYZER_API_BASE", "https://ollama.com/v1")  # VERIFY for your Ollama Cloud
API_KEY = os.environ.get("ANALYZER_API_KEY", "")

TZ = ZoneInfo("America/Chicago")
CAPTURE_DIR = Path(os.environ.get("CAPTURE_DIR", "./captures"))
GROUPS_FILE = Path(os.environ.get("GROUPS_FILE", "./groups.json"))
LOG_DIR = Path(os.environ.get("LOG_DIR", "./logs"))

# System prompts live in sibling .md files (internal_prompt.md, external_prompt.md)
# so non-engineers can iterate on them without touching code. Loaded at import time —
# if a prompt is missing we want to fail loudly, not at the first model call.
PROMPTS_DIR = Path(__file__).resolve().parent


def _load_prompt(filename: str) -> str:
    path = PROMPTS_DIR / filename
    try:
        return path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        sys.exit(
            f"Prompt file not found: {path}\n"
            f"The analyzer expects {filename} next to daily_analyzer.py."
        )


# ── Model call (isolated so it's trivial to swap providers) ──────────────────
def call_model(system: str, user: str) -> str:
    from openai import OpenAI  # pip install openai
    client = OpenAI(base_url=API_BASE, api_key=API_KEY or "ollama")
    resp = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.1,  # low: faithful extraction, not creativity
    )
    return resp.choices[0].message.content or ""


def parse_json(text: str):
    """Parse model output as JSON, tolerating ```json fences and stray prose."""
    t = (text or "").strip()
    t = re.sub(r"^```(?:json)?\s*", "", t)
    t = re.sub(r"\s*```$", "", t)
    # If there's leading/trailing prose, grab the outermost JSON object.
    if not t.startswith("{"):
        m = re.search(r"\{.*\}", t, re.DOTALL)
        if m:
            t = m.group(0)
    return json.loads(t)


# ── Reading (isolated: a byte-offset cursor can replace this later) ──────────
def read_day_messages(jsonl_path: Path, target: date) -> list:
    """Return deduped, non-bot messages for the target Chicago day, time-sorted."""
    if not jsonl_path.exists():
        return []
    seen = set()
    out = []
    with jsonl_path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue  # skip partial/corrupt lines (e.g. a torn last write)
            if r.get("is_bot"):
                continue  # exclude the bot's own sends
            ts = r.get("ts")
            if not ts:
                continue
            mid = r.get("wa_msg_id")
            if mid:
                if mid in seen:
                    continue  # dedup reconnect-replayed lines
                seen.add(mid)
            if datetime.fromtimestamp(ts / 1000, TZ).date() == target:
                out.append(r)
    out.sort(key=lambda r: r.get("ts", 0))
    return out


def format_transcript(messages: list) -> str:
    lines = []
    for m in messages:
        t = datetime.fromtimestamp(m["ts"] / 1000, TZ).strftime("%H:%M")
        who = m.get("sender_name") or m.get("sender_phone") or m.get("sender_lid") or "unknown"
        lines.append(f"[{t}] {who}: {m.get('body', '')}")
    return "\n".join(lines)


# ── Analyses ────────────────────────────────────────────────────────────────
# To change the analysis, edit the .md files — not this script.
INTERNAL_SYSTEM = _load_prompt("internal_prompt.md")
EXTERNAL_SYSTEM = _load_prompt("external_prompt.md")


def analyze(group_type: str, transcript: str) -> dict:
    system = EXTERNAL_SYSTEM if group_type == "external" else INTERNAL_SYSTEM
    user = f"Transcript (times are America/Chicago):\n\n{transcript}"
    return parse_json(call_model(system, user))


# ── Rendering ────────────────────────────────────────────────────────────────
def _coerce_dict(item, key: str) -> dict:
    """Normalize a list item to a dict. Models occasionally return a list of plain
    strings where the schema asks for objects (e.g. ["do X", "do Y"] instead of
    [{"action": "do X", ...}]). Rather than crash the whole group's analysis on a
    `.get()` call against a string, wrap the string under `key` and keep going."""
    if isinstance(item, dict):
        return item
    if isinstance(item, str):
        return {key: item}
    return {}  # numbers, None, lists, etc. — drop them as unusable


def header(meta: dict, target: date, msg_count: int, group_type: str) -> str:
    dept = meta.get("department") or "(unlabeled)"
    subj = meta.get("wa_subject") or ""
    return (
        f"# {dept} — {target.isoformat()}\n\n"
        f"*Group:* {subj}  \n"
        f"*Type:* {group_type}  \n"
        f"*Messages analyzed:* {msg_count}  \n"
        f"*Generated:* {datetime.now(TZ).strftime('%Y-%m-%d %H:%M %Z')}\n\n"
    )


def render_internal(meta, target, msg_count, data) -> str:
    md = header(meta, target, msg_count, "internal")
    md += "## Summary\n\n" + (data.get("summary") or "_No summary._") + "\n\n"

    md += "## Decisions\n\n"
    decisions = data.get("decisions") or []
    md += ("\n".join(f"- {d}" for d in decisions) if decisions else "_None recorded._") + "\n\n"

    md += "## Actions Needed\n\n"
    needed = data.get("actions_needed") or []
    if needed:
        for raw in needed:
            a = _coerce_dict(raw, "action")
            action = a.get("action", "")
            if not action:
                continue
            owner = a.get("owner") or "unassigned"
            md += f"- {action}  — **{owner}**\n"
    else:
        md += "_None recorded._"
    md += "\n\n"

    md += "## Actions Completed\n\n"
    done = data.get("actions_completed") or []
    md += ("\n".join(f"- {d}" for d in done) if done else "_None recorded._") + "\n\n"

    md += "## Blockers / Open Concerns\n\n"
    blockers = data.get("blockers") or []
    md += ("\n".join(f"- {b}" for b in blockers) if blockers else "_None recorded._") + "\n\n"

    md += "## Recurring Themes\n\n"
    themes = data.get("recurring_themes") or []
    md += ("\n".join(f"- {t}" for t in themes) if themes else "_None recorded._") + "\n"
    return md


def render_external(meta, target, msg_count, data) -> str:
    md = header(meta, target, msg_count, "external")
    md += "## Summary\n\n" + (data.get("summary") or "_No summary._") + "\n\n"
    rel = data.get("relevant_message_count")
    ign = data.get("ignored_chatter_count")
    if rel is not None or ign is not None:
        md += f"*Relevant: {rel} · Chatter ignored: {ign}*\n\n"

    md += "## Common Questions from Guests\n\n"
    questions = [_coerce_dict(q, "question") for q in (data.get("questions") or [])]
    questions = [q for q in questions if q.get("question")]
    if questions:
        questions.sort(key=lambda q: q.get("count", 0) if isinstance(q.get("count"), int) else 0, reverse=True)
        for q in questions:
            topic = q.get("topic", "")
            count = q.get("count", 1) if isinstance(q.get("count"), int) else 1
            md += f"- **{q.get('question', '')}** _({topic}, {count} person{'s' if count != 1 else ''})_\n"
            for ex in (q.get("examples") or [])[:2]:
                md += f"  - e.g. \"{ex}\"\n"
    else:
        md += "_No event-relevant questions today._"
    md += "\n\n"

    md += "## Pain Points\n\n"
    pain = [_coerce_dict(p, "summary") for p in (data.get("pain_points") or [])]
    pain = [p for p in pain if p.get("summary") or p.get("topic")]
    if pain:
        for p in pain:
            topic = p.get("topic", "")
            summary = p.get("summary", "")
            md += f"- **{topic}** — {summary}\n" if topic else f"- {summary}\n"
    else:
        md += "_None surfaced today._"
    md += "\n"
    return md


def render_empty(meta, target, group_type) -> str:
    md = header(meta, target, 0, group_type)
    md += "_No messages captured for this day._\n"
    return md


def render_error(meta, target, msg_count, group_type, err, raw) -> str:
    md = header(meta, target, msg_count, group_type)
    md += "## Analysis failed\n\n"
    md += f"The model output could not be parsed: `{err}`\n\n"
    md += "Raw model output (for debugging):\n\n```\n" + (raw or "")[:4000] + "\n```\n"
    return md


# ── Group resolution / paths ─────────────────────────────────────────────────
def load_groups() -> dict:
    try:
        return json.loads(GROUPS_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        sys.exit(f"groups.json not found at {GROUPS_FILE}")
    except json.JSONDecodeError as e:
        sys.exit(f"groups.json is not valid JSON: {e}")


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")


def group_dir_name(jid: str, meta: dict) -> str:
    # Output dir per group is "<numericGroupId>-<slugified-name>" so the folder is
    # unambiguous (jid is the durable key) AND readable at a glance (name for humans).
    # Name preference: human-assigned department > WhatsApp subject > none.
    num = re.sub(r"@.*$", "", jid)
    name = slugify(meta.get("department") or meta.get("wa_subject") or "")
    return f"{num}-{name}" if name else num


def capture_path(jid: str) -> Path:
    num = re.sub(r"@.*$", "", jid)
    num = re.sub(r"[^0-9A-Za-z_-]", "", num)
    return CAPTURE_DIR / f"{num}.jsonl"


def resolve_groups(groups: dict, selector: str) -> list:
    # Accept several "natural" forms of selector so users can paste whatever they
    # see in output (folder name, numeric id, department label, wa_subject).
    sel = selector.lower()
    items = []
    for jid, meta in groups.items():
        if sel == "all":
            items.append((jid, meta))
            continue
        haystacks = [
            jid.lower(),                                       # full JID
            re.sub(r"@.*$", "", jid).lower(),                  # numeric id only
            (meta.get("department") or "").lower(),            # human label
            (meta.get("wa_subject") or "").lower(),            # WhatsApp group name
            group_dir_name(jid, meta).lower(),                 # "<id>-<slug>" folder name
        ]
        if any(sel == h or (h and sel in h) for h in haystacks):
            items.append((jid, meta))
    return items


def resolve_date(s: str) -> date:
    today = datetime.now(TZ).date()
    if s == "yesterday":
        return today - timedelta(days=1)
    if s == "today":
        return today
    return date.fromisoformat(s)


# ── Main ─────────────────────────────────────────────────────────────────────
def process_group(jid: str, meta: dict, target: date) -> str:
    group_type = (meta.get("type") or "internal").lower()
    if group_type not in ("internal", "external"):
        group_type = "internal"

    messages = read_day_messages(capture_path(jid), target)
    out_dir = LOG_DIR / group_dir_name(jid, meta)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{target.isoformat()}.md"

    if not messages:
        out_path.write_text(render_empty(meta, target, group_type), encoding="utf-8")
        return f"{group_dir_name(jid, meta)}: no messages"

    transcript = format_transcript(messages)
    raw = ""
    try:
        raw = call_model(
            EXTERNAL_SYSTEM if group_type == "external" else INTERNAL_SYSTEM,
            f"Transcript (times are America/Chicago):\n\n{transcript}",
        )
        data = parse_json(raw)
        render = render_external if group_type == "external" else render_internal
        out_path.write_text(render(meta, target, len(messages), data), encoding="utf-8")
        return f"{group_dir_name(jid, meta)}: ok ({len(messages)} msgs, {group_type})"
    except Exception as e:
        out_path.write_text(
            render_error(meta, target, len(messages), group_type, str(e), raw),
            encoding="utf-8",
        )
        return f"{group_dir_name(jid, meta)}: ANALYSIS FAILED ({e})"


def main():
    ap = argparse.ArgumentParser(description="Daily WhatsApp group analysis -> markdown logs.")
    ap.add_argument(
        "--group",
        default="all",
        help=(
            "'all' (default), or a substring matched against the department label, "
            "wa_subject, JID, numeric id, or the '<id>-<slug>' folder name."
        ),
    )
    ap.add_argument("--date", default="yesterday", help="yesterday (default) | today | YYYY-MM-DD")
    ap.add_argument(
        "--days",
        type=int,
        default=1,
        help=(
            "Number of consecutive days to analyze, ENDING on --date. Default 1. "
            "Example: --date yesterday --days 7 analyzes the last 7 completed days. "
            "Writes one log per day per group (no combined weekly digest)."
        ),
    )
    ap.add_argument(
        "--captures-dir",
        default=None,
        help="Path to the ingester's captures dir. Overrides the CAPTURE_DIR env var.",
    )
    ap.add_argument(
        "--groups-file",
        default=None,
        help="Path to the ingester's groups.json. Overrides the GROUPS_FILE env var.",
    )
    args = ap.parse_args()

    # CLI > env > default. Mutate the module globals so capture_path() / load_groups() pick them up.
    if args.captures_dir:
        global CAPTURE_DIR
        CAPTURE_DIR = Path(args.captures_dir)
    if args.groups_file:
        global GROUPS_FILE
        GROUPS_FILE = Path(args.groups_file)

    if not CAPTURE_DIR.is_dir():
        sys.exit(f"Captures dir not found: {CAPTURE_DIR}")

    # Fail fast on missing creds — without this the OpenAI client would 401 once per group.
    is_local = ("localhost" in API_BASE) or ("127.0.0.1" in API_BASE)
    if not API_KEY and not is_local:
        sys.exit(
            f"ANALYZER_API_KEY is not set and ANALYZER_API_BASE ({API_BASE}) is not local. "
            "Export ANALYZER_API_KEY=<your Ollama Cloud key> or prefix the command with it."
        )

    try:
        target = resolve_date(args.date)
    except ValueError:
        sys.exit(f"Bad --date: {args.date!r}. Use yesterday | today | YYYY-MM-DD.")

    if args.days < 1:
        sys.exit(f"--days must be >= 1, got {args.days}.")

    # Build the date range ending at `target`, oldest first so logs flow chronologically.
    dates = sorted(target - timedelta(days=i) for i in range(args.days))

    groups = load_groups()
    selected = resolve_groups(groups, args.group)
    if not selected:
        sys.exit(f"No groups matched --group {args.group!r}. Check groups.json.")

    range_label = (
        target.isoformat() if args.days == 1
        else f"{dates[0].isoformat()} → {dates[-1].isoformat()} ({args.days} days)"
    )
    print(f"Analyzing {len(selected)} group(s) for {range_label} (America/Chicago) with {MODEL}")
    for d in dates:
        if args.days > 1:
            print(f"\n[{d.isoformat()}]")
        for jid, meta in selected:
            try:
                print("  " + process_group(jid, meta, d))
            except Exception as e:
                # A single group's failure shouldn't abort the whole batch (cron safety).
                print(f"  {group_dir_name(jid, meta)}: ERROR {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
