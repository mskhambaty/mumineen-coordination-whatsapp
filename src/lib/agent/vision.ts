import { AI_VISION_MODEL, getAIClient } from "@/lib/ai/model";

// Answer a visitor's question about the image they sent — grounded ONLY on what is
// visible in this one image. Deliberately isolated from conversation history and site
// RAG so event context (e.g. hotels) can never bleed in and produce a hallucinated answer.
export async function answerImageQuestion(input: {
  buffer: Buffer;
  mimeType: string;
  question?: string;
}): Promise<string> {
  const client = getAIClient();
  const dataUrl = `data:${input.mimeType};base64,${input.buffer.toString("base64")}`;
  const question = input.question?.trim();

  const instruction = question
    ? `A visitor messaged a WhatsApp help line and sent this image, asking: "${question}". ` +
      `Answer their question naturally and concisely, based ONLY on what is actually visible in THIS image. ` +
      `Read out any relevant text, numbers, names, or IDs exactly as shown. If the image is unrelated to any event, still answer what it shows. ` +
      `Do NOT mention being an AI, that an image was "read", or any "[Image contents]" labels. If you genuinely cannot tell what it is, say so briefly. ` +
      `Never describe anything that is not visible in this specific image.`
    : `A visitor sent this image with no caption. Briefly and naturally describe what it shows, reading out any key text or numbers exactly. ` +
      `Base it ONLY on what is visible in THIS image. Do NOT mention being an AI or that an image was read.`;

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
