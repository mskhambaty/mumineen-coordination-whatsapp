# Setting Up WhatsApp on a Secondary Number (OpenClaw)

How to provision a dedicated, disposable WhatsApp number and connect it to an
already-onboarded OpenClaw instance — configuring the WhatsApp channel via the
CLI (no re-running `openclaw onboard`).

> This number runs automation WhatsApp does not sanction (linked-device reading +
> programmatic sending). Treat it as **disposable**: assume it will eventually be
> banned, and design so re-provisioning is a chore, not a crisis. Never use a real
> person's personal number.

---

## Quick path (dual-eSIM iPhone, no second phone)

Source: @buddyhadry on X. US/iPhone-specific but similar on any dual-eSIM phone.
This is the fastest route to a second line + WhatsApp Business without new hardware.

1. **Tell your spouse/SO you're adding a phone line and why.** (The post lists this
   as the key step. Heed it.)
2. Confirm your iPhone supports **dual eSIM** (iPhone 13 or newer).
3. Settings → General → About → **Carrier Lock** → must read "No SIM restrictions."
   If locked, get it unlocked by your carrier, or add the second line through them.
4. Sign up for a cheap carrier (post used **Tello, ~$10/mo** for a basic plan; any works).
5. Settings → Cellular → **Add eSIM** → scan the carrier's QR. You now have a second line.
6. Install **WhatsApp Business** from the App Store (runs alongside regular WhatsApp,
   supports a separate number).
7. Set up WhatsApp Business with the new line's number.
8. Link it to OpenClaw — see "Connect to OpenClaw" below. **Note:** OpenClaw holds
   only **one linked-device slot per account.** If it's currently linked to your
   personal WhatsApp, delete that linked device inside the WhatsApp app first, or
   the new link will conflict.
9. Message the new number — you're talking to your bot.

> **Command name:** the post says `clawdbot gateway configure`. "Clawdbot" is the
> former name; on current builds it's **`openclaw`**. Use `openclaw gateway configure`
> (wizard) or the no-wizard CLI path below.

> **For a disposable BOT number** (not a personal second line), prefer the
> provisioning notes in section 1 — a dedicated prepaid SIM/eSIM you can re-provision
> when banned, set up under an honest "coordination bot" Business profile. The eSIM
> mechanics above are identical; the difference is you treat the number as throwaway,
> not as your own second line.

---

## 1. Provision the number

Pick a number type that (a) can receive WhatsApp's SMS verification code and
(b) you can cheaply re-provision later. In rough order of reliability:

1. **Dedicated prepaid physical SIM** — most reliable for passing verification
   (real carrier number). Needs a spare device to register on.
2. **Second eSIM** (or a real-carrier eSIM service) — same reliability, no
   physical SIM swap. Good middle ground.
3. **VoIP (Twilio, etc.)** — riskiest. WhatsApp frequently rejects VoIP at
   verification and flags VoIP ranges for automation later. If you must, **test
   that the number can receive the WhatsApp code before depending on it.**

Use the **WhatsApp Business app** for this account (not regular WhatsApp): it's
legitimate for an org, lets you set an honest display name / "automated assistant"
profile note, and is a marginally better posture for a bot account.

## 2. Register and secure

1. Install WhatsApp Business on the registration device; register the new number;
   enter the SMS code.
2. Set an honest display name (e.g. `<Community> Coordination Bot`) and a profile
   note describing what it is.
3. **Enable two-step verification (6-digit PIN)** immediately. **Write the PIN
   down somewhere durable** — you'll need it on re-link, and losing it locks you
   out of your own bot account.

## 3. Warm up (do not skip)

A brand-new number that instantly joins many groups and starts automated activity
is the fastest path to a week-one ban. For the first **5–7 days**, let it behave
like a normal idle member: get added to a group or two, send a hello manually,
reply once or twice. **No automation yet.** Aged accounts with normal-looking
history get far more leeway than fresh ones.

## 4. Get it into the groups

Have an existing group admin **add the number** to each target group. (You cannot
add a bot "to a group" via API — the account is a member, and it sees the groups
it's been added to.) Keep a record of which groups it's in; you'll need that list
on re-provisioning.

## 5. Connect to OpenClaw — via CLI, post-onboard

OpenClaw is already onboarded, so do **not** re-run `openclaw onboard`. Configure
the WhatsApp channel directly with `openclaw config set`, which validates each
change against the live schema as it writes (it refuses unknown keys / bad values,
so a successful set means it's valid).

```bash
# Enable the WhatsApp channel
openclaw config set channels.whatsapp.enabled true

# DM access policy. For "anyone can DM the bot":
openclaw config set channels.whatsapp.dmPolicy "open"
openclaw config set channels.whatsapp.allowFrom '["*"]'
#   For operator-only DMs instead, use your own number and omit dmPolicy "open":
#   openclaw config set channels.whatsapp.allowFrom '["+1XXXXXXXXXX"]'

# Inspect what's set / confirm shape
openclaw config get channels.whatsapp

# Validate the whole config and check for warnings
openclaw doctor
```

Notes on the CLI path:

- `config set` takes a dotted key path and a value. JSON values (arrays/objects)
  are passed as a JSON string, e.g. `'["*"]'`.
- If a `set` is rejected (`invalid config: must not have additional properties` or
  `Invalid input`), the key path or value shape is wrong for your build. Find the
  correct path from the schema:
  `openclaw config schema | grep -n -B5 "<keyName>"`, or use the Control UI
  (`http://127.0.0.1:18789`, Config tab) which renders a form from the live schema.
- The config file is `~/.openclaw/openclaw.json` (JSON5). The gateway hot-reloads
  on change, but restart if a change doesn't take: `openclaw gateway restart`.

### Do NOT add group-read config

If capture is handled by a separate listener (the message ingester), **omit** all
group-read keys — `groups`, `groupPolicy`, `groupAllowFrom`, `messages.groupChat`
activation. Setting them makes OpenClaw wake its agent on every group message
(wasted model calls, risk of replying in-group). Leave groups at default
(mention-only). DMs and group participation are separate axes; opening DMs does not
open group processing.

## 6. Link the device

```bash
openclaw channels login --channel whatsapp
```

Scan the QR with the bot phone: **WhatsApp Business > Settings > Linked Devices >
Link a Device**. Credentials are stored under
`~/.openclaw/credentials/whatsapp/default/`.

> **One linked-device slot per OpenClaw account.** If OpenClaw is already linked to
> a *different* WhatsApp number (e.g. your personal one), delete that linked device
> inside the WhatsApp app first — otherwise the new link conflicts. (Per the source
> post's step 8.) This is separate from WhatsApp's own ~4-companion-device limit on
> the *account* — see the device-budget note below.

> **Verify the exact login command on your build** — `openclaw channels login` vs.
> `openclaw gateway configure` (wizard) vs. a QR shown on gateway start can differ by
> version. Check `openclaw channels --help`.

## 7. Verify

- `openclaw doctor` reports the WhatsApp channel healthy.
- DM the bot from an allowed number; confirm it responds (or pairing-gates an
  unknown sender, per your `dmPolicy`).

---

## Linked-device budget (important if also running the ingester)

WhatsApp allows a limited number of companion (linked) devices per account
(historically ~4). If a separate message-ingester also links this same number, it
consumes **another** device slot with its **own** credentials — never sharing
OpenClaw's `creds.json` (two processes on one set of keys corrupts the session).
One number, two device links: OpenClaw (outbound/DM) + ingester (capture).

A ban/logout on the number kills **both** at once. Keep outbound volume
boringly human-paced — programmatic group posting is the highest ban-risk behavior
and runs on the number everything depends on.

---

## Re-provisioning runbook (when the number is banned/logged out)

1. Re-register the number on the bot phone, **or** provision a fresh disposable
   number and have an admin re-add it to every group (use your recorded group list).
2. Re-link OpenClaw: `openclaw channels login --channel whatsapp`, scan the new QR.
3. If running the separate ingester, re-link it too (clear its auth dir, re-scan).
4. Confirm with `openclaw doctor`.

Keep this written down with: device/SIM, the two-step PIN, the group list, and the
admins who can re-add the number. That turns a ban from a crisis into a 20-minute
chore.
