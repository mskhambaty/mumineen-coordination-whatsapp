import { AI_VISION_MODEL, getAIClient } from "@/lib/ai/model";

// Read an image a visitor sent and turn it into a short text description the main
// agent can reason over (it understands screenshots of ITS pages, tickets, forms, etc.).
export async function describeIncomingImage(input: {
  buffer: Buffer;
  mimeType: string;
  caption?: string;
}): Promise<string> {
  const client = getAIClient();
  const dataUrl = `data:${input.mimeType};base64,${input.buffer.toString("base64")}`;

  const instruction =
    "A visitor to an event support line sent this image over WhatsApp. Describe what it shows in 1-3 sentences so a support agent can help. If it contains readable text (e.g. an ITS page, ticket, booking, form, screenshot, or document), transcribe the key text and any IDs/dates/amounts exactly. Be factual; do not guess." +
    (input.caption ? ` The visitor's caption was: "${input.caption}".` : "");

  const res = await client.chat.completions.create({
    model: AI_VISION_MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: instruction },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
        ],
      },
    ],
    temperature: 0.2,
    max_tokens: 500,
  });

  return res.choices[0]?.message?.content?.trim() ?? "";
}
