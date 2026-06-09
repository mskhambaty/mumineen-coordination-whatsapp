// claw-message-ingester / extract-distinct-phones.js
//
// Read all .jsonl files in CAPTURE_DIR and emit distinct sender phone numbers
// grouped by department/group using groups.json metadata when available.

import fs from 'fs'
import path from 'path'

function parseArgs(argv) {
  const args = {
    captureDir: process.env.CAPTURE_DIR || './captures',
    groupsFile: process.env.GROUPS_FILE || null,
    json: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--capture-dir' && argv[i + 1]) {
      args.captureDir = argv[i + 1]
      i += 1
    } else if (token === '--groups-file' && argv[i + 1]) {
      args.groupsFile = argv[i + 1]
      i += 1
    } else if (token === '--json') {
      args.json = true
    }
  }

  return args
}

function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') return null

  // Common raw format in capture rows: "18472194586@s.whatsapp.net"
  const jidStripped = raw.replace(/@.*/, '')
  const digits = jidStripped.replace(/[^0-9]/g, '')

  // E.164 max is 15 digits. Keep likely phone values only.
  if (digits.length < 8 || digits.length > 15) return null
  return digits
}

function loadGroups(groupsFilePath) {
  if (!fs.existsSync(groupsFilePath)) return {}

  try {
    const raw = fs.readFileSync(groupsFilePath, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function summarizeCaptureFile(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n')
  const phones = new Set()
  let parsedRows = 0
  let invalidRows = 0
  let groupJid = null

  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line)
      parsedRows += 1

      if (!groupJid && typeof row.group_jid === 'string' && row.group_jid.trim()) {
        groupJid = row.group_jid.trim()
      }

      const phone = normalizePhone(row.sender_phone)
      if (phone) phones.add(phone)
    } catch {
      invalidRows += 1
    }
  }

  if (!groupJid) {
    const inferred = path.basename(filePath, '.jsonl')
    groupJid = `${inferred}@g.us`
  }

  return {
    file: path.basename(filePath),
    groupJid,
    distinctPhones: [...phones].sort(),
    parsedRows,
    invalidRows,
  }
}

function groupByDepartmentAndGroup(summaries, groupsByJid) {
  const departments = new Map()

  for (const summary of summaries) {
    const groupMeta = groupsByJid[summary.groupJid] || {}
    const department =
      typeof groupMeta.department === 'string' && groupMeta.department.trim()
        ? groupMeta.department.trim()
        : 'Unassigned'
    const waSubject =
      typeof groupMeta.wa_subject === 'string' && groupMeta.wa_subject.trim()
        ? groupMeta.wa_subject.trim()
        : null

    if (!departments.has(department)) {
      departments.set(department, {
        department,
        groups: [],
        _phoneSet: new Set(),
      })
    }

    const departmentBucket = departments.get(department)
    departmentBucket.groups.push({
      file: summary.file,
      groupJid: summary.groupJid,
      waSubject,
      parsedRows: summary.parsedRows,
      invalidRows: summary.invalidRows,
      distinctPhones: summary.distinctPhones,
    })

    for (const phone of summary.distinctPhones) {
      departmentBucket._phoneSet.add(phone)
    }
  }

  return [...departments.values()]
    .map((bucket) => ({
      department: bucket.department,
      distinctPhones: [...bucket._phoneSet].sort(),
      groups: bucket.groups.sort((a, b) => a.groupJid.localeCompare(b.groupJid)),
    }))
    .sort((a, b) => a.department.localeCompare(b.department))
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const dir = path.resolve(args.captureDir)
  const groupsFile = args.groupsFile
    ? path.resolve(args.groupsFile)
    : path.join(path.dirname(dir), 'groups.json')

  if (!fs.existsSync(dir)) {
    console.error(`Capture directory not found: ${dir}`)
    process.exit(1)
  }

  const groupsByJid = loadGroups(groupsFile)

  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .sort()

  const summaries = files.map((name) => summarizeCaptureFile(path.join(dir, name)))
  const grouped = groupByDepartmentAndGroup(summaries, groupsByJid)

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          captureDir: dir,
          groupsFile,
          fileCount: summaries.length,
          summaries,
          grouped,
        },
        null,
        2,
      ),
    )
    return
  }

  console.log(`Capture directory: ${dir}`)
  console.log(`Groups file: ${groupsFile}`)
  console.log(`JSONL files: ${summaries.length}`)

  if (!fs.existsSync(groupsFile)) {
    console.log('Groups metadata: not found (all files will show as Unassigned)')
  }

  for (const bucket of grouped) {
    console.log(`\nDepartment: ${bucket.department}`)
    console.log(`  distinct phones across department (${bucket.distinctPhones.length}):`)
    if (bucket.distinctPhones.length === 0) {
      console.log('    (none)')
    } else {
      for (const phone of bucket.distinctPhones) {
        console.log(`    - ${phone}`)
      }
    }

    for (const group of bucket.groups) {
      console.log(`\n  Group: ${group.waSubject || '(unknown subject)'} (${group.groupJid})`)
      console.log(`    source file: ${group.file}`)
      console.log(`    parsed rows: ${group.parsedRows}`)
      console.log(`    invalid rows: ${group.invalidRows}`)
      console.log(`    distinct phones (${group.distinctPhones.length}):`)

      if (group.distinctPhones.length === 0) {
        console.log('      (none)')
        continue
      }

      for (const phone of group.distinctPhones) {
        console.log(`      - ${phone}`)
      }
    }
  }
}

main()
