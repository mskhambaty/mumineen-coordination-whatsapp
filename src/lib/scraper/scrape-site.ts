import * as cheerio from "cheerio";

import { AI_EMBEDDING_MODEL, getAIClient } from "@/lib/ai/model";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const SITE_ROOT = "https://www.chicagorelaycenter.com";

const PAGES_TO_SCRAPE = [
  "/",
  "/schedule",
  "/parking",
  "/registration",
  "/directions",
  "/faq",
  "/contact",
];

type ContentChunk = {
  page_url: string;
  page_title: string;
  section: string;
  content: string;
};

export async function scrapeSite() {
  const supabase = getSupabaseAdmin();
  const openai = getAIClient();

  const chunks: ContentChunk[] = [];

  for (const path of PAGES_TO_SCRAPE) {
    const url = `${SITE_ROOT}${path}`;

    let html: string;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      html = await res.text();
    } catch {
      continue;
    }

    const $ = cheerio.load(html);
    const title = $("title").text().trim();

    // Extract meaningful sections: headings + following paragraphs
    $("h1, h2, h3").each((_, el) => {
      const heading = $(el).text().trim();
      const body = $(el).nextUntil("h1, h2, h3").text().trim();
      if (body.length < 30) return;
      chunks.push({
        page_url: url,
        page_title: title,
        section: heading.toLowerCase().replace(/\s+/g, "_").slice(0, 60),
        content: `${heading}\n${body}`.slice(0, 1500),
      });
    });
  }

  if (chunks.length === 0) {
    console.log("No content scraped from site.");
    return;
  }

  // Embed all chunks in batches of 100 to stay within API limits
  const allEmbeddings: number[][] = [];
  const BATCH_SIZE = 100;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const embeddingRes = await openai.embeddings.create({
      model: AI_EMBEDDING_MODEL,
      input: batch.map((c) => c.content),
    });
    for (const item of embeddingRes.data) {
      allEmbeddings.push(item.embedding);
    }
  }

  // Mark old content stale
  await supabase.from("site_content").update({ is_current: false }).eq("is_current", true);

  // Insert fresh content
  const rows = chunks.map((chunk, i) => ({
    ...chunk,
    embedding: JSON.stringify(allEmbeddings[i]),
    scraped_at: new Date().toISOString(),
    is_current: true,
  }));

  const { error } = await supabase.from("site_content").insert(rows);

  if (error) {
    console.error("Failed to insert site content:", error);
    throw error;
  }

  console.log(`Scraped and stored ${rows.length} chunks.`);
}
