# Claw Message Sender

A standalone WhatsApp **send** service built on Baileys. Links as its own WhatsApp
device and exposes a localhost-only `POST /send` endpoint to post messages to
groups. It does **not** capture or read messages — that's the ingester's job.

Independent of `claw-message-ingester`: stop or start either service without
affecting the other. Uses its own device session (your number supports up to 4).

## What it does

- Connects to WhatsApp as its **own** linked device (separate session from the
  ingester and OpenClaw).
- Serves `POST /send { to, text, dryRun }` (bearer-token auth) on `127.0.0.1` only.
- `GET /health` -> `{ ok, connected }`.
- Survives transient disconnects; exits cleanly (no restart) on logout/ban.

## What it does NOT do

- No message capture, no reading, no LLM. Send only.
- No rate limiting, no dept→JID resolution, no templating. Those live in the
  **proxy** that calls this service (keep this dumb).
- Never exposes the port beyond localhost.

## Architecture

```
 [ ticket backend ]  (separate environment)
        │  HTTPS + bearer token, over Tailscale/SSH tunnel
        ▼
 [ proxy ]   - dept name -> group JID (from the ingester's groups.json)
        │    - rate limiting (CRITICAL)  - templating  - allowlisted targets
        │  localhost call ->
        ▼
 [ claw-message-sender  POST /send ]  (127.0.0.1 only, own device)
        ▼
 WhatsApp group
```

The ingester (capture) and sender (send) are two separate services, two device
sessions, on one WhatsApp number. Each can be turned off independently.

## Prerequisites

- Linux host (same box as the ingester is fine).
- Node.js 20+.
- The bot WhatsApp number (Business app), already a member of the target groups.
- A free device slot (you have ingester + sender + optionally OpenClaw; max ~4).

## Setup

```bash
mkdir -p ~/claw-message-sender
cd ~/claw-message-sender
# copy in: package.json, index.js, claw-sender.service, .env.example, .gitignore

npm install

# Required token (service refuses to start without it):
cp .env.example .env
#   edit .env -> set a long random SEND_TOKEN
chmod 600 .env

# First link — interactive, to scan the QR:
set -a && . ./.env && set +a    # load SEND_TOKEN into the shell
node index.js
#   Scan the QR: bot WhatsApp > Settings > Linked Devices > Link a Device.
#   IMPORTANT: this is an ADDITIONAL device. Do NOT remove the ingester's or
#   OpenClaw's device. Confirm the phone's Linked Devices list grows by one.
#   Wait for "Connected. Send service ready." then Ctrl-C.

# Install as a service:
sudo cp claw-sender.service /etc/systemd/system/claw-sender.service
#   edit User=/paths if not 'asc' / not ~/claw-message-sender
sudo systemctl daemon-reload
sudo systemctl enable --now claw-sender
journalctl -u claw-sender -f
```

## Test (localhost)

```bash
TOKEN=$(grep -o 'SEND_TOKEN=.*' .env | cut -d= -f2)

curl -s http://127.0.0.1:8766/health
# -> {"ok":true,"connected":true}

# Dry-run first (sends nothing):
curl -s http://127.0.0.1:8766/send \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"to":"<TESTGROUP>@g.us","text":"test","dryRun":true}'

# Real send to a TEST group (never a live dept group while testing):
curl -s http://127.0.0.1:8766/send \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"to":"<TESTGROUP>@g.us","text":"hello from sender"}'
```

If the ingester is running, a successful send should ALSO appear in the ingester's
`captures/` flagged `is_bot:true` — a nice end-to-end check of both services.

## Configuration

| Var          | Default       | Purpose                                              |
|--------------|---------------|------------------------------------------------------|
| `SEND_TOKEN` | _(required)_  | Bearer token for `/send`. Service exits if unset.    |
| `SEND_PORT`  | `8766`        | Localhost port (distinct from the ingester's 8765).  |
| `AUTH_DIR`   | `./auth-send` | This service's own device session. Keep separate.    |
| `LOG_LEVEL`  | `info`        | Log verbosity.                                       |

## Why a separate service (vs. sending from the ingester)

- **Independent on/off.** Stop the sender without stopping capture, and vice versa.
- **Isolation.** Send bugs/deploys/restarts can't touch the capture process.
- **Cost:** a second device session to link and re-link, and its own auth dir.
  Acceptable here because the number supports up to 4 devices.

Sending is NOT done via OpenClaw: its gateway send is gated behind a device-scope/
pairing flow that's broken on 2026.5.x (loops, `doctor --fix` no-op, only fix is
editing+chmod-ing `paired.json`, which auto-updates undo). A standalone Baileys
sender sidesteps that entirely.

## Gotchas

- **Own device session.** `AUTH_DIR` must be this service's own dir — never share
  the ingester's `./auth` or OpenClaw's creds (two processes on one session = the
  WhatsApp 405 conflict).
- **Outbound is the highest ban-risk behavior**, on the SAME number capture uses.
  A send-triggered ban takes down capture too. Rate-limit in the proxy; human pace.
- **Localhost only.** Never expose `SEND_PORT`. Reach it via the proxy over a
  Tailscale/SSH tunnel.
- **Keep `SEND_TOKEN` in a chmod 600 file**; rotate if exposed.
- **Re-verify Baileys APIs after upgrades** (`sendMessage`, `connection.update`).

## Re-link runbook (logged out / banned)

The service will be stopped, with a "Logged out" line in the journal.

1. Re-register/relink the number on the bot phone (or provision a fresh disposable
   number and re-add it to the groups).
2. `rm -rf ~/claw-message-sender/auth-send`
3. `cd ~/claw-message-sender && set -a && . ./.env && set +a && node index.js`,
   scan the new QR (an additional device — leave the ingester's link alone).
4. `sudo systemctl start claw-sender`

Note: a ban on the number affects all its device sessions, so you'll likely
re-link the ingester too.

## Files

| File                  | Purpose                                              |
|-----------------------|------------------------------------------------------|
| `index.js`            | Connect (own device) + serve the `/send` endpoint.   |
| `package.json`        | Dependencies and scripts.                            |
| `claw-sender.service` | systemd unit template.                               |
| `.env.example`        | Copy to `.env` (chmod 600); set `SEND_TOKEN`.        |
| `.gitignore`          | Excludes `node_modules/`, `auth-send/`, `.env`.      |
