# Claw Message Ingester

A standalone WhatsApp group capture listener built on [Baileys](https://www.npmjs.com/package/@whiskeysockets/baileys). It links as a WhatsApp device, reads every message in the groups its account belongs to, and appends each one to a per-group JSONL file. That's it — capture only. Parsing, identity resolution, and the structured wiki happen in a separate downstream job.

It runs alongside OpenClaw on the same host, on the **same WhatsApp number**, as a **second linked device**.

---

## What it does

- Connects to WhatsApp as a linked device (its own session, separate from OpenClaw's).
- Captures inbound **group** messages only (ignores DMs, its own sends, status broadcasts).
- Writes each message as one JSON line to `captures/<groupId>.jsonl`, capturing sender LID, phone (when available), display name, body, timestamp, and message id.
- Survives transient disconnects; stops cleanly and waits for a human when the number is logged out/banned.

## What it does NOT do

- It does not reply, react, or send anything. Capture is read-only. (Outbound notifications are OpenClaw's job, not this listener's.)
- It does not download media. Media messages are recorded with a placeholder body (`<media:image>`, etc.) so the row exists, but the file isn't fetched.
- It does not parse, dedupe, or structure messages. That's the downstream extraction job's responsibility.

---

## Architecture (where this fits)

```
WhatsApp dept groups
        │  (live messages)
        ▼
 [ claw-message-ingester ]   ← this project: capture only, append-only
        │  writes
        ▼
 captures/<groupId>.jsonl    ← raw, durable, append-only store
        │  read on an interval
        ▼
 [ extraction job ]          ← separate, future: dedupe → LLM extract → structured wiki
        │
        ▼
   structured wiki (DB)      ← queryable/updatable; NOT files

 [ OpenClaw ]                ← separate concern: OUTBOUND notifications via admin RPC
```

Capture (this listener) and outbound (OpenClaw) are deliberately separate processes. They share one WhatsApp number but use two independent device links. See "Why this way."

---

## Prerequisites

- A Linux host (this is where OpenClaw already runs).
- Node.js 20+ (`node -v`). OpenClaw already pulls in a modern Node, so you're likely set.
- A dedicated, **disposable** WhatsApp number (Business app) already added to the target group(s) by an admin, and warmed up (used normally for a few days before automating).

---

## Setup (repeatable)

```bash
# 1. Place the project
mkdir -p ~/claw-message-ingester
cd ~/claw-message-ingester
# copy these files in: package.json, index.js, store.js, peek.js,
#                      claw-ingester.service, .gitignore

# 2. Install dependencies
npm install

# 3. First link — run interactively to scan the QR
node index.js
#   A QR code prints in the terminal.
#   On the BOT phone: WhatsApp > Settings > Linked Devices > Link a Device > scan it.
#   You'll see "Connected. Capturing group messages."

# 4. Verify capture
#   Send a test message in the group from another phone, then in a second terminal:
node peek.js
#   You should see the message with a sender name/phone. Ctrl-C the listener when satisfied.

# 5. Install as a service (survives reboots/crashes)
sudo cp claw-ingester.service /etc/systemd/system/claw-ingester.service
#   Edit the User= and paths in that file if you're not user 'asc' / not in ~/claw-message-ingester.
sudo systemctl daemon-reload
sudo systemctl enable --now claw-ingester
journalctl -u claw-ingester -f
```

That's the whole process. Re-running it on a fresh host = the same 5 steps.

---

## Configuration (env vars)

| Var           | Default        | Purpose                                            |
|---------------|----------------|----------------------------------------------------|
| `AUTH_DIR`    | `./auth`       | This listener's WhatsApp session. **Never** point at OpenClaw's creds. |
| `CAPTURE_DIR` | `./captures`   | Where per-group `.jsonl` files are written.        |
| `LOG_LEVEL`   | `info`         | Listener log verbosity.                            |

## Output format

`captures/<groupId>.jsonl`, one JSON object per line:

```json
{"group_jid":"120363410038900760@g.us","sender_lid":"105802257973377@lid","sender_phone":"18472194586@s.whatsapp.net","sender_name":"Hussain","body":"tents confirmed for the 3rd","ts":1780633737000,"wa_msg_id":"AC9C02C0...","}
```

- `sender_lid` — WhatsApp's privacy LinkedID. Always present. Stable per person → use as the durable join key for identity.
- `sender_phone` — the real number, present **when** the linked device has the LID→phone mapping cached. May be null for some senders. Treat as a bonus, not a guarantee.
- `sender_name` — WhatsApp display name (`pushName`). Human-readable, usually present.

---

## Why this way

- **Standalone listener, not OpenClaw, for capture.** OpenClaw's group capture paths are broken/unreliable for silent ingestion in this version (group `message:received` hooks don't fire for non-mention group messages; plugin `messageReceived` group capture is filed as broken upstream). Baileys at the raw layer delivers group messages with sender metadata reliably. OpenClaw is kept only for outbound.
- **JSONL files, not a DB, for raw capture.** Capture should be dumb, durable, append-only. Files have no server to run, no write-lock contention (single writer), and reads are safe while writing. The structured *wiki* still belongs in a DB — files are for the raw layer only.
- **Live only, no history backfill.** `syncFullHistory: false` + `type === 'notify'`. Backfill over this transport is unreliable; for coordination, "from link-time forward" is what matters.
- **Exit (not loop) on logout.** A tight reconnect loop against WhatsApp after a ban looks like abuse and risks deepening the ban. The listener exits 1 and systemd is told not to restart it (`RestartPreventExitStatus=1`), forcing a deliberate human re-link.

---

## Gotchas

- **One number = two linked devices.** OpenClaw holds one device slot; this listener holds another. A logout/ban on the number kills **both** capture and outbound at once. Budget for re-linking both (see runbook).
- **Never share auth state with OpenClaw.** Two processes on one set of WhatsApp keys corrupts the session. `AUTH_DIR` must be this project's own directory.
- **`sender_phone` is not guaranteed.** WhatsApp is moving toward hiding numbers (LIDs). Build identity resolution keyed on `sender_lid`, enriched by phone/name when present. (Downstream concern — capture stores all three.)
- **Media isn't downloaded.** Media messages get a placeholder body. If departments share decisions as images/PDFs/voice notes, extend the handler to fetch+store media.
- **Reconnects can duplicate lines.** Append-only means a reconnect replay may re-append a message. Dedupe downstream by `wa_msg_id` (it's unique per message).
- **Keep outbound human-paced.** Programmatic group posting (OpenClaw's side) is the highest ban-risk behavior and runs on the same number this listener depends on. Throttle it.
- **Consent.** The community/group admins should know an automated system reads and stores these messages. This is a people step, not a config step.

---

## Re-link runbook (when the number is logged out / banned)

The service will be stopped, with a "Logged out" line in the journal.

1. Re-register the number on the bot phone, **or** provision a fresh disposable number and have an admin re-add it to every group.
2. Clear the dead session: `rm -rf ~/claw-message-ingester/auth`
3. Re-link interactively: `cd ~/claw-message-ingester && node index.js`, scan the new QR.
4. Restart the service: `sudo systemctl start claw-ingester`
5. **Re-link OpenClaw too** — same number, so its session also died. (This is the coupled-failure cost of running one number for both jobs.)

---

## Files

| File                    | Purpose                                                       |
|-------------------------|---------------------------------------------------------------|
| `index.js`              | The listener: connect, capture group messages, persist.       |
| `store.js`              | Storage layer (JSONL files). Swap this to change where data lands. |
| `discover-groups.js`    | Enumerate the bot's groups; merge JID→department into `groups.json`. |
| `peek.js`               | Read-side helper to inspect recent captures.                  |
| `package.json`          | Dependencies and scripts (`npm start`, `npm run peek`).       |
| `claw-ingester.service` | systemd unit template.                                        |
| `.gitignore`            | Excludes `node_modules/`, `auth/`, `captures/`.               |

---

## Group name mapping (groupId → department)

Captured messages carry a group JID (`120363410038900760@g.us`), not a name. The
extraction/wiki layer needs to route each group to a department, so maintain a
`groups.json` map: **group JID → canonical department label.**

The canonical `department` is *your* taxonomy and must match your wiki's department
list — it is NOT the WhatsApp group subject (which is whatever an admin typed,
emoji and all, and can change). So WhatsApp's group name is captured as a hint
(`wa_subject`), but your `department` label is the stable routing key.

### Discover and label

`discover-groups.js` enumerates the groups the bot is in and merges them into
`groups.json`. **Stop the listener first** — it shares the `./auth` session, and two
processes on one set of credentials corrupt it:

```bash
sudo systemctl stop claw-ingester
node discover-groups.js
sudo systemctl start claw-ingester
```

It's idempotent and safe to re-run as the bot joins more groups:

- New group → added with `department: ""` for you to fill in.
- Existing group → WhatsApp subject refreshed; your `department` label preserved.
- Never deletes entries.

After running, edit `groups.json` and set the `department` for any new groups:

```json
{
  "120363410038900760@g.us": {
    "department": "Site/Construction",
    "wa_subject": "🏗️ Site & Construction 1448H"
  }
}
```

> This is a small lookup (~one row per department group), maintained by hand after
> the script discovers JIDs. Don't over-build it — no UI, no auto-sync. The script
> saves you copying JIDs; the labeling is a one-time human pass per new group.

> Keep this separate from the sender-identity map (LID → person). They're keyed
> differently (group JID vs sender LID) and serve different layers.

---

## OpenClaw config (fresh install)

Capture is handled entirely by this listener, so OpenClaw needs **no** WhatsApp
group config at all. Its only roles are: be reachable by DM, and (later) send
outbound notifications. The entire WhatsApp channel block is:

```json5
{
  channels: {
    whatsapp: {
      enabled: true,
      dmPolicy: "open",      // process DMs from any sender (no pairing gate)
      allowFrom: ["*"]       // anyone can DM the bot
    }
  }
}
```

That's the whole block. Deliberately absent:

- **No `groups` / `groupPolicy` / `groupAllowFrom`.** These make OpenClaw
  *participate in* groups, which would wake its agent (and the local model) on
  every group message and risk it replying in-group. Group messages are captured
  by the ingester, not OpenClaw. Leave them out. Direct messages and group
  participation are separate axes — opening DMs does **not** open groups.
- **No `messages.groupChat` activation / `webhooks` / `pluginHooks` keys.** Those
  were the (broken) group-capture experiments. The ingester replaces them.

### Open-DM caveats (decide on purpose)

`dmPolicy: "open"` + `allowFrom: ["*"]` means **any** sender who finds the number
triggers an agent run (and a local-model call) per message. Implications:

- It's an abuse/load surface — strangers can spam it or attempt prompt-injection
  against whatever tools the agent exposes. Review the agent's default tools and
  system prompt **before** opening DMs to everyone.
- It's more inbound traffic on the same number that runs capture and outbound. A
  ban on this number takes the ingester down too.

If you only want the operator to DM the bot, use `allowFrom: ["+1XXXXXXXXXX"]`
(your number) and drop `dmPolicy: "open"` instead.

### Verify on your build

```bash
openclaw config schema | grep -A8 dmPolicy   # confirm "open" is the expected value
```

### Outbound notifications (separate, later phase)

The bot account is a group member, so OpenClaw can send to a group JID regardless
of the (absent) group read config — `allowFrom` does not gate outbound group sends.
When wiring that up, the settings live under `gateway`, **not** `channels.whatsapp`
(this block stays untouched): enable the admin RPC surface, set a `gateway.auth`
token, keep the gateway bound to loopback, and reach it cross-environment via
Tailscale/SSH tunnel rather than opening the port. Verify exact keys against
`openclaw config schema` on your build.
