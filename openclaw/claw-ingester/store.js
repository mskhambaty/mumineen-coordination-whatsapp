// claw-message-ingester / store.js
//
// The ONLY file that knows about storage. Swap this implementation to change
// where raw messages land (e.g. Postgres/Supabase later) without touching index.js.
//
// Current strategy: append-only JSONL, one file per group.
//   captures/<numericGroupId>.jsonl   — one JSON record per line.
//
// Append-only is deliberate: capture stays dumb and durable. Dedup, parsing,
// and structuring happen downstream in the extraction job, not here.

import fs from 'fs'
import path from 'path'

const DIR = process.env.CAPTURE_DIR || './captures'
fs.mkdirSync(DIR, { recursive: true })

export function persist(r) {
  // "120363410038900760@g.us" -> "120363410038900760"
  const id = String(r.group_jid).replace(/@.*$/, '').replace(/[^0-9A-Za-z_-]/g, '')
  const file = path.join(DIR, `${id}.jsonl`)
  fs.appendFileSync(file, JSON.stringify(r) + '\n')
}
