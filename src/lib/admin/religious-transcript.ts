// Religious / Lisan chat export — a self-contained, mobile-readable HTML transcript.
// Pure (string in/out) so it is unit-testable and has no DB/Next coupling.

// The two agent tools that mark a conversation as "religious" for filtering/export.
export const RELIGIOUS_TOOL_NAMES = ["answer_religious_questions", "get_lisan_word_meaning"] as const;
export type ReligiousToolName = (typeof RELIGIOUS_TOOL_NAMES)[number];

export type ExportTimelineItem =
  | { kind: "msg"; direction: "inbound" | "outbound"; body: string; at: string }
  | { kind: "tool"; toolName: string; at: string };

export type ExportConvo = {
  displayName: string | null;
  phoneLast4: string;
  timeline: ExportTimelineItem[];
};

export type ExportRange = { from: string | null; to: string | null; generatedAt: string };

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Deterministic, locale-independent stamp: "2026-06-14 05:23" (UTC, from an ISO string).
function fmt(at: string): string {
  return esc(at.slice(0, 16).replace("T", " "));
}

const PRETTY_TOOL: Record<string, string> = {
  answer_religious_questions: "Waaz / reflection",
  get_lisan_word_meaning: "Lisan word meaning",
};

function toolLabel(name: string): string {
  return `${PRETTY_TOOL[name] ?? name} (${name})`;
}

// Render one conversation's interleaved messages + tool-call chips.
function renderConvo(c: ExportConvo): string {
  const title = `${esc(c.displayName || "Unknown")} · …${esc(c.phoneLast4)}`;
  const rows = c.timeline
    .map((item) => {
      if (item.kind === "tool") {
        return `<div class="tool">⟢ ${esc(toolLabel(item.toolName))}</div>`;
      }
      const side = item.direction === "inbound" ? "in" : "out";
      const who = item.direction === "inbound" ? "User" : "Bot";
      return (
        `<div class="row ${side}">` +
        `<div class="bubble"><div class="meta">${who} · ${fmt(item.at)}</div>` +
        `<div class="body">${esc(item.body || "").replace(/\n/g, "<br>")}</div></div></div>`
      );
    })
    .join("\n");
  return `<section class="convo"><h2>${title}</h2>${rows}</section>`;
}

export function renderReligiousChatsHtml(convos: ExportConvo[], range: ExportRange): string {
  const rangeLabel =
    range.from || range.to ? `${range.from ?? "start"} → ${range.to ?? "now"}` : "all dates";
  const body = convos.length
    ? convos.map(renderConvo).join("\n")
    : `<p class="empty">No religious / Lisan chats found for ${esc(rangeLabel)}.</p>`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Religious / Lisan chats — ${esc(rangeLabel)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #ece5dd; color: #111; }
  .wrap { max-width: 680px; margin: 0 auto; padding: 12px; }
  header.top { position: sticky; top: 0; background: #075e54; color: #fff; padding: 12px 14px; border-radius: 0 0 10px 10px; }
  header.top h1 { margin: 0 0 2px; font-size: 17px; }
  header.top .sub { font-size: 12px; opacity: .85; }
  .convo { margin: 16px 0; }
  .convo > h2 { position: sticky; top: 58px; background: #128c7e; color: #fff; font-size: 14px; margin: 0; padding: 8px 12px; border-radius: 8px; }
  .row { display: flex; margin: 6px 2px; }
  .row.in { justify-content: flex-start; }
  .row.out { justify-content: flex-end; }
  .bubble { max-width: 82%; padding: 7px 10px; border-radius: 10px; box-shadow: 0 1px 1px rgba(0,0,0,.12); white-space: normal; word-wrap: break-word; }
  .row.in .bubble { background: #fff; border-top-left-radius: 2px; }
  .row.out .bubble { background: #dcf8c6; border-top-right-radius: 2px; }
  .meta { font-size: 10px; color: #667781; margin-bottom: 2px; }
  .body { font-size: 14px; line-height: 1.35; }
  .tool { text-align: center; font-size: 11px; color: #5b6b73; margin: 4px 0; font-family: ui-monospace, Menlo, monospace; }
  .empty { text-align: center; color: #555; padding: 40px 12px; }
  @media (prefers-color-scheme: dark) {
    body { background: #0b141a; color: #e9edef; }
    .row.in .bubble { background: #202c33; }
    .row.out .bubble { background: #005c4b; }
    .meta { color: #8696a0; }
  }
</style>
</head><body><div class="wrap">
<header class="top"><h1>Religious / Lisan chats</h1>
<div class="sub">${esc(rangeLabel)} · ${convos.length} conversation${convos.length === 1 ? "" : "s"} · generated ${fmt(range.generatedAt)}</div></header>
${body}
</div></body></html>`;
}
