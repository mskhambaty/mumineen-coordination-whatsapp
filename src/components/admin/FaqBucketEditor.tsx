"use client";

import ContentBucketEditor from "@/components/admin/ContentBucketEditor";

// Thin wrapper around ContentBucketEditor for a department's FAQ bucket. Kept so existing
// callers (FAQ & Guides page, inbox quick-edit) stay unchanged.
export default function FaqBucketEditor({
  departmentId,
  departmentName,
  initialContent,
  adminKey,
  onClose,
  onSaved,
}: {
  departmentId: string;
  departmentName: string;
  initialContent: string;
  adminKey: string;
  onClose: () => void;
  onSaved?: (chunkCount: number) => void;
}) {
  return (
    <ContentBucketEditor
      title={`${departmentName} — FAQ`}
      initialContent={initialContent}
      endpoint={`/api/admin/faq-buckets/${departmentId}`}
      adminKey={adminKey}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}
