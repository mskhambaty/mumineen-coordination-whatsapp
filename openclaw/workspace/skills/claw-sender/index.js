// claw-message-sender / index.js
//
// Standalone WhatsApp SEND service. Links as its OWN device (a separate session
// from the ingester and from OpenClaw) and exposes a localhost-only HTTP endpoint
// to post messages to WhatsApp JIDs. It does NOT capture or read messages.
//
// Independent of the ingester: stop/start either one without affecting the other.
// Uses its own device slot (you have up to 4 per number).
//
//   POST /send   { "to": "<jid>@g.us", "text": "...", "dryRun": false }
//                Authorization: Bearer <SEND_TOKEN>
//   GET  /health -> { ok, connected }
//
// Run interactively the FIRST time to scan the QR, then run under systemd.

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys'
import P from 'pino'
import http from 'http'
import qrcode from 'qrcode-terminal'

const logger = P({ level: process.env.LOG_LEVEL || 'info' })

// This service's OWN auth/session. Separate from the ingester's ./auth and from
// OpenClaw's credentials. This is a distinct linked device.
const AUTH_DIR = process.env.AUTH_DIR || './auth-send'

// Required: bearer token for the /send endpoint. Fail-closed — no token, no service.
const SEND_TOKEN = process.env.SEND_TOKEN
const HOST = '127.0.0.1' // localhost only, always
const PORT = Number(process.env.SEND_PORT || 8766) // distinct from the ingester's port

let currentSock = null
let connected = false

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: 'silent' }),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  })

  sock.ev.on('creds.update', saveCreds)
  currentSock = sock

  sock.ev.on('connection.update', (u) => {
    const { connection, lastDisconnect, qr } = u

    if (qr) {
      qrcode.generate(qr, { small: true })
      logger.info('Scan the QR above: bot WhatsApp > Settings > Linked Devices > Link a Device')
    }

    if (connection === 'open') {
      connected = true
      logger.info('Connected. Send service ready.')
    }

    if (connection === 'close') {
      connected = false
      const code = lastDisconnect?.error?.output?.statusCode
      const loggedOut = code === DisconnectReason.loggedOut
      logger.warn({ code, loggedOut }, 'connection closed')

      if (loggedOut) {
        // Number unlinked/banned. Don't loop against WhatsApp — exit and wait for
        // a human re-link. systemd has RestartPreventExitStatus=1.
        logger.error('Logged out. Clear AUTH_DIR and re-link per the runbook, then restart.')
        process.exit(1)
      } else {
        start() // transient drop — reconnect
      }
    }
  })
}

function startServer() {
  if (!SEND_TOKEN) {
    logger.error('SEND_TOKEN not set — refusing to start (fail-closed).')
    process.exit(1)
  }

  const server = http.createServer((req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(obj))
    }

    if (req.method === 'GET' && req.url === '/health') {
      return send(200, { ok: true, connected })
    }

    if (req.method !== 'POST' || req.url !== '/send') {
      return send(404, { ok: false, error: 'not found' })
    }

    const auth = req.headers['authorization'] || ''
    if (auth !== `Bearer ${SEND_TOKEN}`) {
      return send(401, { ok: false, error: 'unauthorized' })
    }

    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 64 * 1024) req.destroy()
    })
    req.on('end', async () => {
      let payload
      try {
        payload = JSON.parse(raw)
      } catch {
        return send(400, { ok: false, error: 'invalid json' })
      }

      const { to, text, dryRun } = payload || {}
      if (typeof to !== 'string' || !(to.endsWith('@g.us') || to.endsWith('@s.whatsapp.net'))) {
        return send(400, { ok: false, error: 'to must be a WhatsApp JID (@g.us or @s.whatsapp.net)' })
      }
      if (typeof text !== 'string' || !text.trim()) {
        return send(400, { ok: false, error: 'text required' })
      }

      if (dryRun) {
        logger.info({ to, text }, 'send dry-run (not sent)')
        return send(200, { ok: true, dryRun: true, to, text })
      }
      if (!currentSock || !connected) {
        return send(503, { ok: false, error: 'not connected to WhatsApp' })
      }

      try {
        const sent = await currentSock.sendMessage(to, { text })
        logger.info({ to, id: sent?.key?.id }, 'sent')
        return send(200, { ok: true, to, id: sent?.key?.id || null })
      } catch (e) {
        logger.error({ to, err: e.message }, 'send failed')
        return send(502, { ok: false, error: e.message })
      }
    })
  })

  server.on('error', (e) => {
    logger.error({ err: e.message }, 'server error')
    process.exit(1)
  })
  server.listen(PORT, HOST, () => {
    logger.info({ host: HOST, port: PORT }, 'send endpoint listening (localhost only)')
  })
}

start().catch((e) => {
  logger.error({ err: e.message }, 'fatal startup error')
  process.exit(1)
})

startServer()
