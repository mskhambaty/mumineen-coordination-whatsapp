# CLAUDE.md — Claw Message Ingester

Project context for Claude Code. This captures decisions and state that aren't
obvious from the code alone. Read this first.

## What this is

A standalone WhatsApp **group message capture** listener built on Baileys
(`@whiskeysockets/baileys`). It links as a WhatsApp device and appends every
inbound group message to per-group JSONL files. Capture only — no replies, no
sending, no LLM. It runs alongside (but independent of) an OpenClaw instance on
the same Azure host, on the **same WhatsApp number**, as a **second linked device**.

See `README.md` for full setup/run details and `secondary-whatsapp-setup.md`
(in the parent outputs dir) for provisioning the WhatsApp number.

## Architecture decisions (and why)

- **Standalone Baileys listener for capture, NOT OpenClaw.** OpenClaw's group
  capture is unreliable on the installed build: agent-layer `message:received`
  hooks don't fire for non-mention group messages, and the plugin
  `pluginHooks.messageReceived` path for silent group capture is filed as broken
  upstream (OpenClaw issues #64525, #54613, #70794). Baileys at the raw layer
  delivers group messages + sender metadata reliably. OpenClaw is kept ONLY for
  future outbound notifications.
- **JSONL files for the raw store, not a DB.** Capture must be dumb, durable,
  append-only. One file per group: `captures/<numericGroupId>.jsonl`. The
  structured *wiki* (later) belongs in a DB; raw capture does not. `store.js` is
  the only file that knows about storage — swap it to change the backend.
- **Sender identity: LID is the durable key, phone is enrichment.** WhatsApp's LID
  rollout masks phone numbers. Each message carries a stable `participant` LID
  (always present) and sometimes the real phone under `participantPn` OR
  `participantAlt` (field name varies by addressing mode/version — we read both).
  Identity resolution (future) MUST key on `sender_lid`; treat phone/name as
  attributes filled in opportunistically. Do not build identity keyed on phone.
- **Bot's own messages are captured and flagged `is_bot:true`.** We do NOT skip
  `fromMe`. When OpenClaw posts outbound notifications to groups, those land in
  the record too; the extraction layer should exclude `is_bot` messages from
  "what the humans decided" while keeping the audit trail.
- **Group-name resolution is in-process in the listener.** On first sight of an
  unknown group, the listener calls `sock.groupMetadata(jid)` on its LIVE socket
  and writes `{department:"", wa_subject}` to `groups.json`. NO separate script
  (a standalone fetcher needs its own connection → session conflict → WhatsApp
  405). `department` is the human-assigned canonical label (the routing key the
  wiki uses); the listener never overwrites it. `wa_subject` is WhatsApp's group
  name, a hint only.
- **Live messages only.** `syncFullHistory:false` + only `type==='notify'`.
  Backfill over this transport is unreliable; "from link-time forward" is enough.
- **Exit (not loop) on logout.** On `DisconnectReason.loggedOut`, exit 1; systemd
  has `RestartPreventExitStatus=1`. A tight reconnect loop after a ban looks like
  abuse. A logged-out number requires a deliberate human re-link.

## Hard constraints / gotchas

- **One process per `./auth` session.** Two processes (or the listener + a fetch
  script) on the same WhatsApp credentials → WhatsApp 405 / corrupted session.
  This is why group resolution is in-process, not a separate script.
- **One number = two linked devices** (OpenClaw + this listener), each with its
  OWN credentials. NEVER point this listener's `AUTH_DIR` at OpenClaw's creds.
  A ban/logout on the number takes BOTH down — re-link both (see README runbook).
- **Baileys ships breaking changes ~monthly.** Re-verify event shapes
  (`messages.upsert`, `connection.update`) and method names (`groupMetadata`,
  `fetchLatestBaileysVersion`) after any dependency bump.
- **Bot number is disposable.** Assume it will be banned eventually; the re-link
  runbook (README) is first-class, not an afterthought.
- **Privacy:** real community members' messages (names, phones) flow to JSONL and,
  with verbose logging on, to the journal. The community/admins have been told an
  automated system reads/stores group messages. Keep it that way.

## Current state (as of handoff)

- Capture works: group messages land in JSONL with `sender_lid`, `sender_phone`
  (when present), `sender_name`, `body`, `ts`, `wa_msg_id`, `is_bot`.
- In-process group-name resolution into `groups.json` just added.
- **OPEN ITEM:** the listener's WhatsApp session got soured (status 405) by
  repeated concurrent connections during setup. It needs ONE clean re-link:
  `rm -rf ./auth` → `node index.js` → scan QR → confirm capture → run as service.
  Confirm TWO devices show in the phone's Linked Devices (OpenClaw + listener).
- OpenClaw WhatsApp config should be minimal: `enabled`, `dmPolicy:"open"`,
  `allowFrom:["*"]` (anyone can DM). NO group-read keys. Verify with
  `openclaw config get channels.whatsapp`.

## Next steps (not yet built)

1. **Identity table** — `sender_lid` → person → role/department. Self-populating
   from captured `sender_phone`/`sender_name`. Upstream of both extraction and a
   future DM-bot authz gate.
2. **Wiki schema** — per-department structured record (open tasks w/ owner+due+
   status, decisions, blockers, key dates). Define BEFORE writing the extractor;
   `groups.json` `department` values must match this taxonomy.
3. **Extraction job** — interval (~4h): read JSONL since a per-group watermark,
   dedupe by `wa_msg_id`, resolve identity, LLM-extract into the schema, UPSERT
   into the wiki (accrete, don't re-summarize). Model: a hosted Flash-tier model
   (cloud is acceptable per project decision); isolate the model name behind one
   config value. The local `gemma4:31b` is too weak for faithful multilingual
   structured extraction.
4. **Outbound notifications (OpenClaw)** — via `admin-http-rpc` + `gateway.auth`
   token, gateway bound to loopback, reached cross-env via Tailscale/SSH tunnel.
   Deterministic templated sends (no LLM rewording). Human-paced volume — outbound
   posting is the highest ban-risk behavior on the shared number.
5. **DM-bot tools + authz** — when the DM bot gets wiki-lookup tools, gate each by
   caller identity at the TOOL layer (not the prompt). Authz validates the user in
   another system. Sensitive tools must not ship ahead of the authz gate.

## Conventions

- Plain JS, ESM (`"type":"module"`). No TypeScript syntax in `.js` files.
- `store.js` is the storage seam. Keep capture logic free of storage specifics.
- Don't add a management UI / auto-sync for `groups.json` — it's a small hand-
  maintained lookup. Avoid over-engineering small lookups.