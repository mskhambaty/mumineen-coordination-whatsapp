// claw-message-ingester / peek.js
//
// Read-side helper. Prints the most recent captured messages across all groups.
// Safe to run while the listener is writing — reads don't lock, and partial
// last-line writes are skipped (try/catch on parse).
//
//   node peek.js            # last 10 lines per group
//   node peek.js 25         # last 25 lines per group

import fs from 'fs'
import path from 'path'

const DIR = process.env.CAPTURE_DIR || './captures'
const limit = Number(process.argv[2]) || 10

if (!fs.existsSync(DIR)) {
  console.log(`No capture dir yet at ${DIR} — nothing captured.`)
  process.exit(0)
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.jsonl'))
if (files.length === 0) {
  console.log('No .jsonl capture files yet.')
  process.exit(0)
}

let grand = 0
for (const f of files) {
  const lines = fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').filter(Boolean)
  grand += lines.length
  console.log(`\n=== ${f} (${lines.length} messages) ===`)
  for (const line of lines.slice(-limit)) {
    let r
    try { r = JSON.parse(line) } catch { continue } // skip partial/last-line writes
    const when = new Date(r.ts).toISOString()
    const who = r.sender_name || r.sender_phone || r.sender_lid || 'unknown'
    console.log(`${when}  ${who}  —  ${String(r.body).slice(0, 80)}`)
  }
}
console.log(`\nTotal captured across ${files.length} group(s): ${grand}`)
