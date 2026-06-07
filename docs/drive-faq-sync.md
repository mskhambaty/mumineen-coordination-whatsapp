# Drive FAQ folder → knowledge base sync (#89)

Automatically indexes FAQ documents from the shared Google Drive **"WhatsApp"
FAQ folder** into the bot's knowledge base, so a team that hydrates/updates a
doc on Drive no longer depends on a manual portal upload by one person.

## What it does

- Walks the configured Drive folder (and its subfolders) on a daily cron.
- For each supported file, maps it 1:1 to a `knowledge_documents` row
  (`source = 'drive_sync'`, keyed by `drive_file_id`):
  - **new file** → insert + extract text + chunk + embed (index)
  - **changed file** (Drive `modifiedTime` changed) → re-index in place
  - **unchanged file** → skip
  - **removed file** → **left in place by default** (safe). To make the sync
    also delete docs whose Drive file was removed, opt in with
    `GDRIVE_SYNC_DELETE_REMOVED=true`.
- Best-effort department scoping: if a file sits in a subfolder whose name
  matches a department, the doc is filed under that department.

### Supported file types

Reuses the existing parser (`src/lib/knowledge/parse.ts`):

| Drive type | Handled as |
|---|---|
| Google Doc | exported to .docx → `word` |
| Google Sheet | exported to .xlsx → `excel` |
| PDF | `pdf` |
| Word (.docx/.doc) | `word` |
| Excel (.xlsx/.xls) | `excel` |
| CSV | `csv` |

Other types (Slides, images, etc.) are skipped.

## One-time setup

1. **Create a Google Cloud service account** and enable the **Google Drive API**
   for its project.
2. **Create a JSON key** for the service account and download it.
3. **Share the Drive "WhatsApp" FAQ folder** with the service account's email
   (the `client_email` in the JSON), at least **Viewer**.
4. **Set environment variables** (Vercel project settings):
   - `GOOGLE_SERVICE_ACCOUNT_JSON` — the full JSON key, pasted as a single value.
   - `GDRIVE_FAQ_FOLDER_ID` — the folder id from its URL
     (`drive.google.com/drive/folders/<THIS_ID>`).
   - `GDRIVE_SYNC_DELETE_REMOVED` — optional; **default keeps** docs whose Drive
     file was removed. Set to `true` only if you want the sync to also delete them.
   - (`CRON_SECRET` already exists and guards the cron route.)
5. **Run the migration** `20260606210000_knowledge_drive_sync.sql` (adds
   `source`, `drive_file_id`, `drive_modified_time` to `knowledge_documents`).

## Running it

- **Automatic:** the Vercel cron `/api/cron/drive-sync` runs daily at 04:30 UTC
  (just after the site scrape). Auth: `Authorization: Bearer $CRON_SECRET`.
- **Manual ("Sync now"):** the admin **Knowledge → FAQ & Guides** page has a
  **Google Drive sync** panel with **Dry run** and **Sync now** buttons.
  - *Dry run* (`POST /api/admin/knowledge/drive-sync?dryRun=true`) previews the
    plan — reads only, writes nothing, embeds nothing.
  - *Sync now* (`POST /api/admin/knowledge/drive-sync`) performs the sync.
  - Both return `{ ok, stats }` where stats =
    `{ dryRun, scanned, added, updated, skipped, deleted, errors[], plan[] }`.

## Notes / follow-ups

- Until this is deployed with credentials, the interim process stands: docs only
  go live when uploaded via `/admin/knowledge`.
- The service account only needs **read-only** Drive scope
  (`drive.readonly`).
