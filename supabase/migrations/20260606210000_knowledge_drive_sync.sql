-- Drive FAQ folder sync (#89): let documents originate from the shared Google
-- Drive "WhatsApp" FAQ folder and be re-synced on change.
--
-- - source:              'upload' (manual portal upload, default) | 'drive_sync'
-- - drive_file_id:       the Google Drive file id, used to dedupe/upsert on re-sync
-- - drive_modified_time: Drive's modifiedTime, used to detect changed files

alter table public.knowledge_documents
  add column if not exists source text not null default 'upload',
  add column if not exists drive_file_id text,
  add column if not exists drive_modified_time timestamptz;

-- One knowledge_document per Drive file (enables upsert-by-file on re-sync).
create unique index if not exists knowledge_documents_drive_file_id_key
  on public.knowledge_documents (drive_file_id)
  where drive_file_id is not null;
