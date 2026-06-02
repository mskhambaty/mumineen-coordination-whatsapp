import * as cheerio from "cheerio";

import { AI_EMBEDDING_MODEL, getAIClient } from "@/lib/ai/model";
import { optionalEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const DEFAULT_SITE_ROOT = "https://ashara1448relay.chicagojamaat.org";
const DEFAULT_HOTEL_SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1Zf0hoZ0Sty66e9_k4fEDhdEwWclbF0mG9ZvzbqotYF8/export?format=csv";
const HOTEL_SHEET_SOURCE_URL =
  "https://docs.google.com/spreadsheets/d/1Zf0hoZ0Sty66e9_k4fEDhdEwWclbF0mG9ZvzbqotYF8/edit?usp=sharing";

const SEED_PATHS = [
  "/",
  "/hotels",
  "/travel-venue",
  "/get-involved",
];

const MAX_PAGES = 30;
const MAX_CHUNK_CHARS = 1800;
const MIN_CHUNK_CHARS = 40;

// Placeholder/"coming soon" pages carry no real answers but match many queries and
// say "being finalized", which poisons retrieval. Skip short chunks that are just that.
const PLACEHOLDER_RE =
  /coming soon|will be published|being finalis|being finaliz|site is being prepared|details will be (shared|published)/i;

function isPlaceholderChunk(content: string): boolean {
  return content.length < 400 && PLACEHOLDER_RE.test(content);
}

type ContentChunk = {
  page_url: string;
  page_title: string;
  section: string;
  content: string;
};

export async function scrapeSite() {
  const supabase = getSupabaseAdmin();
  const openai = getAIClient();
  const siteRoot = normalizeSiteRoot(optionalEnv("RELAY_SITE_ROOT") ?? DEFAULT_SITE_ROOT);
  const pageUrls = await discoverSitePages(siteRoot);
  // The internal hotel Google sheet is now superseded by FAQ & Guides uploads, so it
  // is OFF by default (it carried stale/far-hotel data). Re-enable with SCRAPE_HOTEL_SHEET=true.
  const hotelSheetUrl = optionalEnv("HOTEL_SHEET_CSV_URL") ?? DEFAULT_HOTEL_SHEET_CSV_URL;
  const hotelSheetEnabled = optionalEnv("SCRAPE_HOTEL_SHEET") === "true";
  const chunks: ContentChunk[] = [];
  let siteChunkCount = 0;

  for (const url of pageUrls) {
    let html: string;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      html = await res.text();
    } catch {
      continue;
    }

    const $ = cheerio.load(html);
    const pageChunks = extractContentChunks($, url).filter((chunk) => !isPlaceholderChunk(chunk.content));
    siteChunkCount += pageChunks.length;
    chunks.push(...pageChunks);
  }

  const hotelChunks = hotelSheetEnabled ? await scrapeHotelSheet(hotelSheetUrl) : [];
  chunks.push(...hotelChunks);

  if (chunks.length === 0) {
    console.log("No content scraped from site.");
    return {
      discoveredPages: pageUrls.length,
      siteChunks: 0,
      hotelChunks: 0,
      reusedChunks: 0,
      embeddedChunks: 0,
      staleChunks: 0,
      insertedChunks: 0,
    };
  }

  const uniqueChunks = Array.from(new Map(chunks.map((chunk) => [chunkKey(chunk), chunk])).values());
  // Only scraped rows participate in stale-marking. NEVER touch FAQ & Guides uploads
  // (page_url 'knowledge://...') — they aren't part of the scrape and were being wiped.
  const { data: existingRows, error: existingError } = await supabase
    .from("site_content")
    .select("id, page_url, section, content")
    .eq("is_current", true)
    .not("page_url", "like", "knowledge://%");

  if (existingError) {
    console.error("Failed to load current site content:", existingError);
    throw existingError;
  }

  const currentKeys = new Set(uniqueChunks.map(chunkKey));
  const existingByKey = new Map(
    (existingRows ?? []).map((row) => [
      chunkKey({
        page_url: row.page_url as string,
        section: row.section as string,
        content: row.content as string,
      }),
      row.id as number,
    ]),
  );
  const staleIds = (existingRows ?? [])
    .filter((row) => !currentKeys.has(chunkKey({
      page_url: row.page_url as string,
      section: row.section as string,
      content: row.content as string,
    })))
    .map((row) => row.id as number);
  const newChunks = uniqueChunks.filter((chunk) => !existingByKey.has(chunkKey(chunk)));

  // Embed all chunks in batches of 100 to stay within API limits
  const allEmbeddings: number[][] = [];
  const BATCH_SIZE = 100;

  for (let i = 0; i < newChunks.length; i += BATCH_SIZE) {
    const batch = newChunks.slice(i, i + BATCH_SIZE);
    const embeddingRes = await openai.embeddings.create({
      model: AI_EMBEDDING_MODEL,
      input: batch.map((c) => c.content),
    });
    for (const item of embeddingRes.data) {
      allEmbeddings.push(item.embedding);
    }
  }

  for (let i = 0; i < staleIds.length; i += BATCH_SIZE) {
    const batch = staleIds.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from("site_content")
      .update({ is_current: false })
      .in("id", batch);

    if (error) {
      console.error("Failed to mark stale site content:", error);
      throw error;
    }
  }

  // Insert fresh content
  const rows = newChunks.map((chunk, i) => ({
    ...chunk,
    embedding: JSON.stringify(allEmbeddings[i]),
    scraped_at: new Date().toISOString(),
    is_current: true,
  }));

  const { error } = rows.length > 0
    ? await supabase.from("site_content").insert(rows)
    : { error: null };

  if (error) {
    console.error("Failed to insert site content:", error);
    throw error;
  }

  const stats = {
    discoveredPages: pageUrls.length,
    siteChunks: siteChunkCount,
    hotelChunks: hotelChunks.length,
    reusedChunks: uniqueChunks.length - newChunks.length,
    embeddedChunks: newChunks.length,
    staleChunks: staleIds.length,
    insertedChunks: rows.length,
  };

  console.log(`Scraped and stored ${rows.length} chunks.`, stats);
  return stats;
}

function chunkKey(chunk: Pick<ContentChunk, "page_url" | "section" | "content">) {
  return `${chunk.page_url}\n${chunk.section}\n${chunk.content}`;
}

async function scrapeHotelSheet(csvUrl: string): Promise<ContentChunk[]> {
  try {
    const res = await fetch(csvUrl);
    if (!res.ok) {
      console.error(`Hotel sheet export failed: ${res.status}`);
      return [];
    }

    const csv = await res.text();
    return hotelRowsToChunks(parseCsv(csv));
  } catch (err) {
    console.error("Hotel sheet scrape failed:", err);
    return [];
  }
}

async function discoverSitePages(siteRoot: string) {
  const origin = new URL(siteRoot).origin;
  const seen = new Set<string>();
  const queue = SEED_PATHS.map((path) => new URL(path, siteRoot).toString());

  for (let i = 0; i < queue.length && seen.size < MAX_PAGES; i += 1) {
    const url = normalizeUrl(queue[i]);
    if (!url || seen.has(url)) continue;
    seen.add(url);

    let html: string;
    try {
      const res = await fetch(url);
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok || !contentType.includes("text/html")) continue;
      html = await res.text();
    } catch {
      continue;
    }

    const $ = cheerio.load(html);
    $("a[href]").each((_, link) => {
      const href = $(link).attr("href");
      if (!href) return;

      const nextUrl = normalizeUrl(new URL(href, url).toString());
      if (!nextUrl) return;

      const parsed = new URL(nextUrl);
      if (parsed.origin !== origin || seen.has(nextUrl) || queue.includes(nextUrl)) return;
      if (isSkippablePath(parsed.pathname)) return;

      queue.push(nextUrl);
    });
  }

  return Array.from(seen);
}

function extractContentChunks($: cheerio.CheerioAPI, pageUrl: string): ContentChunk[] {
  $("script, style, noscript, svg").remove();

  const pageTitle = cleanText($("title").first().text()) || cleanText($("h1").first().text()) || pageUrl;
  const chunks: ContentChunk[] = [];

  $("h1, h2, h3").each((_, el) => {
    const heading = cleanText($(el).text());
    const body = cleanText($(el).nextUntil("h1, h2, h3").text());
    const text = cleanText([heading, body].filter(Boolean).join("\n"));

    for (const part of splitText(text)) {
      chunks.push({
        page_url: pageUrl,
        page_title: pageTitle,
        section: slugify(heading || pageTitle),
        content: part,
      });
    }
  });

  if (chunks.length > 0) {
    return chunks;
  }

  const fallback = cleanText($("main").text() || $("body").text());
  return splitText(fallback).map((content) => ({
    page_url: pageUrl,
    page_title: pageTitle,
    section: "page",
    content,
  }));
}

function splitText(text: string) {
  const normalized = cleanText(text);
  if (normalized.length < MIN_CHUNK_CHARS) return [];
  if (normalized.length <= MAX_CHUNK_CHARS) return [normalized];

  const parts: string[] = [];
  const sentences = normalized.split(/(?<=[.!?])\s+|\n+/);
  let current = "";

  for (const sentence of sentences) {
    if (!sentence.trim()) continue;
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > MAX_CHUNK_CHARS && current.length >= MIN_CHUNK_CHARS) {
      parts.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }

  if (current.length >= MIN_CHUNK_CHARS) {
    parts.push(current.slice(0, MAX_CHUNK_CHARS));
  }

  return parts;
}

function hotelRowsToChunks(rows: string[][]): ContentChunk[] {
  const [headers, ...dataRows] = rows;
  if (!headers?.length) return [];

  return dataRows.flatMap((row) => {
    const values = Object.fromEntries(
      headers.map((header, index) => [cleanHeader(header), cleanText(row[index] ?? "")]),
    );
    const name = values.name;
    if (!name) return [];

    const lines = [
      `Hotel: ${name}`,
      formatField("Address", [values.address, values.city, values.zip].filter(Boolean).join(", ")),
      formatField("Miles from masjid", values.miles_from_masjid),
      formatField("Website", values.website),
      formatField("Phone", values.phone_number),
      formatField("Rooms available during Ashara", values.rooms_available_during_ashara_june_14_25),
      formatField("Room types during Ashara", values.types_of_rooms_potential_during_ashara_june_14_25),
      formatField("Potential people during Ashara", values.people_potential_during_ashara),
      formatField("Reservation contact", [values.contact_person_for_reservations_discounts, values.contact_person_email_address, values.contact_person_direct_line].filter(Boolean).join(" | ")),
      formatField("Convention room available", values.convention_room_available_y_n),
      formatField("Largest convention room capacity", values.total_capacity_of_largest_convention_room),
      formatField("Bulk discount rate", values.bulk_discount_rate),
      formatField("O'Hare shuttle", values.o_hare_shuttle_y_n),
      formatField("Midway shuttle", values.midway_shuttle_y_n),
      formatField("Shuttle to masjid", values.shuttle_to_masjid_y_n),
      formatField("Breakfast included", values.breakfast_included_y_n),
      formatField("Can order halal food", values.can_they_order_halal_food_y_n),
      formatField("Preferred", values.preferred_y_n),
      formatField("Block rate", values.block_rate),
      formatField("Booking code", values.code),
      formatField("Booking link", values.link),
      formatField("Notes", values.notes),
    ].filter(Boolean);

    return [{
      page_url: HOTEL_SHEET_SOURCE_URL,
      page_title: "Ashara Relay Hotel Information Sheet",
      section: `hotel_${slugify(name)}`,
      content: lines.join("\n"),
    }];
  });
}

function formatField(label: string, value: string) {
  return value ? `${label}: ${value}` : "";
}

function parseCsv(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    const next = csv[i + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        field += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);

  return rows;
}

function cleanHeader(header: string) {
  return cleanText(header)
    .toLowerCase()
    .replace(/#/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function normalizeSiteRoot(siteRoot: string) {
  return siteRoot.endsWith("/") ? siteRoot : `${siteRoot}/`;
}

function normalizeUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function isSkippablePath(pathname: string) {
  return /\.(?:pdf|png|jpe?g|gif|webp|svg|ico|css|js|zip)$/i.test(pathname);
}

function cleanText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function slugify(text: string) {
  return cleanText(text).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60) || "page";
}

export const scraperInternals = {
  discoverSitePages,
  extractContentChunks,
  hotelRowsToChunks,
  parseCsv,
  splitText,
};
