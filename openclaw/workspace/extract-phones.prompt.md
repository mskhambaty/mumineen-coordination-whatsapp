You are running a deterministic data extraction task.

Goal:
List distinct sender phone numbers grouped by department and WhatsApp group.

Rules:
- Do not summarize or infer phone numbers from message text.
- Use only sender_phone fields present in the JSONL rows.
- Normalize each phone by removing any @... suffix and keeping digits only.
- Ignore empty or invalid phone values.
- Use groups metadata from groups.json (same folder level as captures) to map group_jid to department and wa_subject.
- If groups.json is missing, use department value Unassigned.

Execution:
1. Run this command:
   npm run extract:phones -- --capture-dir /home/asc/claw-message-ingester/captures --json
2. Parse the JSON output.
3. Return a markdown table with:
   - department
   - group_jid
   - wa_subject
   - distinct_phone_count
   - phones (comma-separated)

If the capture folder does not exist, return the exact error and suggest verifying CAPTURE_DIR in the ingester service.
If groups.json is missing or unreadable, continue and mark every row as department Unassigned.
