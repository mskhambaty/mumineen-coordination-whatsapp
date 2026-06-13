# Outbound Messaging — Sending to WhatsApp Groups

Sending is a **separate standalone service**, `claw-message-sender`, with its own
WhatsApp device session. It is independent of the capture ingester (stop/start
either without affecting the other) and does NOT use OpenClaw.

> Full setup, files, and runbook live in the `claw-message-sender` project README.
> This doc is the high-level "how outbound fits" overview.

> **Why not OpenClaw?** OpenClaw's gateway send is gated behind a device-scope /
> pairing approval flow broken on 2026.5.x (confirmed locally + open upstream
> issues #22062 #22574 #21688 #68634 #76956 #70687). The approval loops,
> `doctor --fix` doesn't resolve it, and the only "fix" is editing `paired.json`
> and chmod-ing it read-only — which the next auto-update can undo. A standalone
> Baileys sender sidesteps that entire class of bug.

> **Why a separate service (not folded into the ingester)?** So capture and send
> can be turned on/off independently, and send bugs/deploys/restarts can't touch
> the capture process. Cost: a second device session (the number supports ~4).

---

## Architecture

```
 [ ticket backend ]  (separate environment)
        │  HTTPS + bearer token, over Tailscale/SSH tunnel
        ▼
 [ proxy ]  (Phase 2 — you own it)
        │  - dept name -> group JID (from the ingester's groups.json)
        │  - rate limiting (CRITICAL — protects the shared number)
        │  - templating (fixed notification text)
        │  - allowlisted targets
        │  localhost call ->
        ▼
 [ claw-message-sender  POST /send ]  (127.0.0.1 only, own device session)
        │  sock.sendMessage(jid, { text })
        ▼
 WhatsApp group   (the bot account is a member, so it can post)
```

Three independent pieces on one WhatsApp number, up to ~4 device slots:
- `claw-message-ingester` — capture (read-only), own device session.
- `claw-message-sender` — send only, own device session.
- (optional) OpenClaw — for the future DM bot, NOT outbound.

---

## Principles

- **Outbound is the highest ban-risk behavior**, on the SAME number capture uses.
  A send-triggered ban kills capture too. Rate-limit (in the proxy); human pace;
  batch; never per-event real-time spray.
- **Deterministic text** — the sender posts your exact string; no LLM in the path.
- **Target by JID** from `groups.json` (the proxy resolves dept name -> JID).
- **Test against a THROWAWAY group**, never a live department group.
- **Localhost only** — the sender's `/send` port is never exposed; the proxy
  reaches it over a Tailscale/SSH tunnel.

---

## Phase 1 — Stand up the sender + local test

Follow the `claw-message-sender` README: install, set `SEND_TOKEN` (chmod 600
`.env`), link its own device via QR (an ADDITIONAL device — leave the ingester's
and OpenClaw's links alone), run it, then test on localhost:

```bash
TOKEN=$(grep -o 'SEND_TOKEN=.*' .env | cut -d= -f2)
curl -s http://127.0.0.1:8766/health
curl -s http://127.0.0.1:8766/send -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to":"<TESTGROUP>@g.us","text":"test","dryRun":true}'    # dry-run first
```

A real send to a test group should also appear in the ingester's `captures/`
flagged `is_bot:true` (both services on one number) — a nice end-to-end check.

## Phase 2 — Proxy layer (cross-environment triggering)

The ticket backend (separate environment) can't reach the VM's localhost. Don't
expose the sender's port. Instead:

- Run a thin proxy you own; the ticket backend calls the proxy; the proxy calls
  `http://127.0.0.1:8766/send`.
- Reach the proxy over Tailscale / SSH tunnel, never a public port.
- The proxy holds the real controls: dept->JID resolution, **rate limiting**,
  templating, its own API key, allowlisted targets.
- Blast radius of a leaked proxy credential = "send a templated notice to a known
  group," not control of the account.

---

## Open items

- [ ] Confirm `sock.sendMessage(jid, { text })` posts to a `@g.us` group on your
      Baileys version (sender README Phase: dry-run then real send to a test group).
- [ ] Outbound send appears in the ingester's `captures/` flagged `is_bot:true`.
- [ ] Build the proxy (dept->JID, rate limiting, templating).
