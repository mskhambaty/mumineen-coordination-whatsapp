import type { ParsedNewMember } from "@/lib/transcripts/parser";

export type ExistingTranscriptTask = {
  id: string;
  title: string | null;
  status: string | null;
  item_type: "task" | "issue" | null;
};

export type ExistingTranscriptMilestone = {
  id: string;
  title: string | null;
  status: string | null;
  percent_complete?: number | null;
  budget?: number | string | null;
};

export type ExistingTranscriptUser = {
  display_name: string | null;
  transcript_aliases: string[] | null;
};

export type ExistingTranscriptItems = {
  tasks: ExistingTranscriptTask[];
  milestones: ExistingTranscriptMilestone[];
};

export type TranscriptReviewAction = "create" | "update";
export type TranscriptReviewKind = "task" | "issue" | "milestone";

export type TranscriptReviewFields = {
  review_action: TranscriptReviewAction;
  review_kind: TranscriptReviewKind;
  target_id: string | null;
  target_title: string | null;
  target_status: string | null;
  review_label: string;
};

type EventForReview = {
  event_type: string;
  item_type?: "task" | "issue" | "milestone" | null;
  task_title?: string | null;
  milestone_title?: string | null;
  ai_summary?: string | null;
  message_text?: string | null;
  task_id?: string | null;
  milestone_id?: string | null;
};

const updateEventTypes = new Set([
  "task_updated",
  "task_completed",
  "milestone_updated",
  "issue_updated",
  "issue_resolved",
]);

export function buildEventReview(
  event: EventForReview,
  existingItems: ExistingTranscriptItems,
): TranscriptReviewFields {
  const reviewKind = inferReviewKind(event);
  const directTarget = findDirectTarget(event, reviewKind, existingItems);
  const matchedTarget = directTarget ?? findBestTarget(event, reviewKind, existingItems);
  const explicitUpdate = updateEventTypes.has(event.event_type);
  const duplicateCreate = !explicitUpdate && matchedTarget && matchedTarget.score >= 0.88;
  const reviewAction: TranscriptReviewAction = explicitUpdate || duplicateCreate ? "update" : "create";
  const target = reviewAction === "update" ? matchedTarget : null;

  return {
    review_action: reviewAction,
    review_kind: reviewKind,
    target_id: target?.id ?? null,
    target_title: target?.title ?? null,
    target_status: target?.status ?? null,
    review_label: buildReviewLabel(reviewAction, reviewKind, target?.title ?? null),
  };
}

export function addReviewFieldsToEvents<T extends EventForReview>(
  events: T[],
  existingItems: ExistingTranscriptItems,
): Array<T & TranscriptReviewFields> {
  return events.map((event) => ({
    ...event,
    ...buildEventReview(event, existingItems),
  }));
}

export function filterUnknownNewMembers(
  newMembers: ParsedNewMember[],
  existingUsers: ExistingTranscriptUser[],
): ParsedNewMember[] {
  const knownAliases = new Set<string>();

  for (const user of existingUsers) {
    addNormalizedAlias(knownAliases, user.display_name);
    for (const alias of user.transcript_aliases ?? []) {
      addNormalizedAlias(knownAliases, alias);
    }
  }

  return newMembers.filter((member) => {
    const normalizedAlias = normalizeComparable(member.alias);
    return normalizedAlias && !knownAliases.has(normalizedAlias);
  });
}

function inferReviewKind(event: EventForReview): TranscriptReviewKind {
  if (event.item_type === "milestone" || event.event_type.startsWith("milestone")) return "milestone";
  if (event.item_type === "issue" || event.event_type.startsWith("issue")) return "issue";
  return "task";
}

function findDirectTarget(
  event: EventForReview,
  reviewKind: TranscriptReviewKind,
  existingItems: ExistingTranscriptItems,
) {
  if (reviewKind === "milestone" && event.milestone_id) {
    const milestone = existingItems.milestones.find((item) => item.id === event.milestone_id);
    return milestone ? toScoredTarget(milestone, 1) : null;
  }

  if ((reviewKind === "task" || reviewKind === "issue") && event.task_id) {
    const task = existingItems.tasks.find((item) => item.id === event.task_id);
    return task ? toScoredTarget(task, 1) : null;
  }

  return null;
}

function findBestTarget(
  event: EventForReview,
  reviewKind: TranscriptReviewKind,
  existingItems: ExistingTranscriptItems,
) {
  const title = getEventTitle(event, reviewKind);
  if (!title) return null;

  const candidates = reviewKind === "milestone"
    ? existingItems.milestones
    : existingItems.tasks.filter((task) => (task.item_type ?? "task") === reviewKind);

  let best: ReturnType<typeof toScoredTarget> | null = null;
  for (const candidate of candidates) {
    const score = compareTitles(title, candidate.title);
    if (score < 0.56) continue;
    if (!best || score > best.score) {
      best = toScoredTarget(candidate, score);
    }
  }

  return best;
}

function toScoredTarget(
  item: ExistingTranscriptTask | ExistingTranscriptMilestone,
  score: number,
) {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    score,
  };
}

function getEventTitle(event: EventForReview, reviewKind: TranscriptReviewKind): string | null {
  if (reviewKind === "milestone") {
    return event.milestone_title || event.task_title || event.ai_summary || event.message_text || null;
  }

  return event.task_title || event.ai_summary || event.message_text || null;
}

function buildReviewLabel(
  action: TranscriptReviewAction,
  kind: TranscriptReviewKind,
  targetTitle: string | null,
) {
  const noun = kind === "milestone" ? "milestone" : kind === "issue" ? "issue" : "task";
  if (action === "create") return `Create new ${noun}`;
  return targetTitle ? `Update existing ${noun}: ${targetTitle}` : `Update existing ${noun}`;
}

function compareTitles(left: string | null, right: string | null): number {
  const normalizedLeft = normalizeComparable(left);
  const normalizedRight = normalizeComparable(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) return 0.92;

  const leftTokens = tokenize(normalizedLeft);
  const rightTokens = tokenize(normalizedRight);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;

  const rightSet = new Set(rightTokens);
  const intersection = leftTokens.filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const containment = intersection / Math.min(leftTokens.length, rightTokens.length);
  const jaccard = intersection / union;

  return Math.max(jaccard, containment * 0.9);
}

function tokenize(value: string): string[] {
  return value
    .split(" ")
    .filter((token) => token.length > 1 && !["the", "and", "for", "with", "from", "this", "that"].includes(token));
}

function addNormalizedAlias(aliases: Set<string>, alias: string | null | undefined) {
  const normalized = normalizeComparable(alias);
  if (normalized) aliases.add(normalized);
}

function normalizeComparable(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
