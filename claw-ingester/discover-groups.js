// claw-message-ingester / discover-groups.js
//
// Enumerates the WhatsApp groups the bot account belongs to and MERGES them into
// groups.json (a map of group JID -> canonical department label). Re-runnable:
// safe to run again whenever the bot is added to more groups.
//
// Merge behavior (idempotent):
//   - New group (JID not in file) -> added with department: "" for you to fill in.
//   - Existing group              -> wa_subject refreshed; your `department` label preserved.
//   - Never deletes entries.
//
// IMPORTANT: only ONE process may use the ./auth session at a time. The listener
// shares these credentials, so STOP it before running this, then restart:
//   sudo systemctl stop claw-ingester
//   node discover-groups.js
//   sudo systemctl start claw-ingester

import makeWASocket, { useMultiFileAuthState } from '@whiskeysockets/baileys'
import P from 'pino'
import fs from 'fs'

const AUTH_DIR = process.env.AUTH_DIR || './auth'
const FILE = process.env.GROUPS_FILE || './groups.json'

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'))
  } catch {
    return {} // file doesn't exist yet — start fresh
  }
}

const existing = load()

const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
const sock = makeWASocket({ auth: state, logger: P({ level: 'silent' }) })
sock.ev.on('creds.update', saveCreds)

sock.ev.on('connection.update', async ({ connection, qr }) => {
  if (qr) {
    console.error('Not linked — this auth session has no credentials.')
    console.error('Link the listener first (node index.js, scan QR), then re-run.')
    process.exit(1)
  }
  if (connection !== 'open') return

  let groups
  try {
    // Returns { [jid]: GroupMetadata }. Verify this method name against your
    // Baileys version if it throws — the API shifts between releases.
    groups = await sock.groupFetchAllParticipating()
  } catch (e) {
    console.error('Failed to fetch groups:', e.message)
    process.exit(1)
  }

  const merged = { ...existing }
  const newOnes = []
  for (const [jid, meta] of Object.entries(groups)) {
    if (merged[jid]) {
      // Preserve the human-assigned department; only refresh the WhatsApp subject.
      merged[jid].wa_subject = meta.subject || merged[jid].wa_subject
    } else {
      merged[jid] = { department: '', wa_subject: meta.subject || '' }
      newOnes.push({ jid, subject: meta.subject })
    }
  }

  fs.writeFileSync(FILE, JSON.stringify(merged, null, 2) + '\n')

  console.log(`Synced ${Object.keys(groups).length} group(s) into ${FILE}.`)
  if (newOnes.length) {
    console.log(`\n${newOnes.length} NEW group(s) need a department label:`)
    for (const g of newOnes) console.log(`  ${g.jid}  —  ${g.subject}`)
    console.log(`\nEdit ${FILE} and set "department" for each new group.`)
  } else {
    console.log('No new groups. Existing department labels preserved.')
  }
  process.exit(0)
})
