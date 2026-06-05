// claw-message-ingester / index.js
//
// Standalone WhatsApp group capture listener.
// Links as its OWN device (separate from OpenClaw) and appends every inbound
// group message to a per-group JSONL file via store.js.
//
// Run interactively the FIRST time to scan the QR, then run under systemd.

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys'
import P from 'pino'
import qrcode from 'qrcode-terminal'
import { persist } from './store.js'

const logger = P({ level: process.env.LOG_LEVEL || 'info' })

// Where this listener stores ITS auth/session. Must NOT point at OpenClaw's
// credentials (~/.openclaw/credentials/...). This is a second linked device.
const AUTH_DIR = process.env.AUTH_DIR || './auth'

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: 'silent' }), // keep Baileys' internal chatter out of our logs
    markOnlineOnConnect: false,     // don't broadcast presence — quieter footprint
    syncFullHistory: false,         // live messages only; no (unreliable) backfill
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', (u) => {
    const { connection, lastDisconnect, qr } = u

    if (qr) {
      qrcode.generate(qr, { small: true })
      logger.info('Scan the QR above: bot WhatsApp > Settings > Linked Devices > Link a Device')
    }

    if (connection === 'open') {
      logger.info('Connected. Capturing group messages.')
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      const loggedOut = code === DisconnectReason.loggedOut
      logger.warn({ code, loggedOut }, 'connection closed')

      if (loggedOut) {
        // Number was unlinked or banned. Do NOT auto-reconnect — a tight loop
        // against WhatsApp is itself ban-flavored. Exit and wait for a human
        // re-link per the runbook. systemd is configured not to restart on exit 1.
        logger.error('Logged out. Clear AUTH_DIR and re-link per the runbook, then restart.')
        process.exit(1)
      } else {
        start() // transient drop — reconnect
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return // fresh incoming only, not history sync

    for (const msg of messages) {
      const jid = msg.key?.remoteJid || ''
      if (!jid.endsWith('@g.us')) continue   // groups only
      if (jid === 'status@broadcast') continue
      // NOTE: we no longer skip fromMe. The bot's own group messages (e.g.
      // outbound notifications) are captured too, flagged with is_bot:true below,
      // so the conversation record is complete. The extraction layer can exclude
      // is_bot messages from "what the humans decided" while keeping the audit trail.

      const m = msg.message || {}
      let body =
        m.conversation ??
        m.extendedTextMessage?.text ??
        m.imageMessage?.caption ??
        m.videoMessage?.caption ??
        m.documentMessage?.caption ??
        ''

      // Don't silently drop non-text messages — record a placeholder so the
      // row (who/when) still exists even if we don't capture the media itself.
      if (!body) {
        if (m.imageMessage) body = '<media:image>'
        else if (m.videoMessage) body = '<media:video>'
        else if (m.audioMessage) body = '<media:audio>'
        else if (m.documentMessage) body = '<media:document>'
        else if (m.stickerMessage) body = '<media:sticker>'
        else continue // truly empty / system message — skip
      }

      const record = {
        group_jid: jid,
        is_bot: !!msg.key?.fromMe,                    // true = sent by the bot's own account
        sender_lid: msg.key?.participant || null,    // privacy LID — stable per person; the durable join key
        // Phone JID arrives under different field names depending on addressing
        // mode / WhatsApp version. Read both; prefer whichever is populated.
        // Phone is an ENRICHMENT attribute, not the identity key (it may be absent).
        sender_phone: msg.key?.participantPn || msg.key?.participantAlt || null,
        sender_name: msg.pushName || null,            // WhatsApp display name
        body,
        ts: Number(msg.messageTimestamp) * 1000,      // ms epoch
        wa_msg_id: msg.key?.id || null,
      }

      try {
        await persist(record)
        logger.info(record, 'captured')
      } catch (e) {
        // Never lose a message because the disk write hiccuped — log it raw.
        logger.error({ err: e.message, record }, 'persist failed')
      }
    }
  })
}

start().catch((e) => {
  logger.error({ err: e.message }, 'fatal startup error')
  process.exit(1)
})
