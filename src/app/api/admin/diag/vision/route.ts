import { NextRequest, NextResponse } from "next/server";

import { requireAdminKey } from "@/lib/api/auth";
import { describeIncomingImage } from "@/lib/agent/vision";
import { AI_VISION_MODEL } from "@/lib/ai/model";
import { fetchWhatsAppMedia } from "@/lib/meta/whatsapp";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Admin diagnostic: run the full image-reading pipeline for a stored image message
// and report exactly which step fails (media download vs. vision call). Auth via the
// x-admin-key header (dashboard button) or a `key` query param (open in a browser).
//   GET /api/admin/diag/vision?messageId=<uuid>
export async function GET(req: NextRequest) {
  const queryKey = req.nextUrl.searchParams.get("key");
  const queryKeyOk = Boolean(process.env.ADMIN_API_KEY) && queryKey === process.env.ADMIN_API_KEY;
  if (!queryKeyOk && !requireAdminKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const messageId = req.nextUrl.searchParams.get("messageId");
  const result: Record<string, unknown> = { vision_model: AI_VISION_MODEL };

  // If no messageId given, just look up the latest inbound image to test.
  const supabase = getSupabaseAdmin();
  let raw: unknown;
  if (messageId) {
    const { data } = await supabase.from("messages").select("raw_payload").eq("id", messageId).maybeSingle();
    raw = data?.raw_payload;
  } else {
    const { data } = await supabase
      .from("messages")
      .select("id, raw_payload")
      .eq("message_type", "image")
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    raw = data?.raw_payload;
    result.tested_message_id = data?.id ?? null;
  }

  const image = (raw as { message?: { image?: { id?: string; mime_type?: string } } } | null)?.message?.image;
  if (!image?.id) {
    return NextResponse.json({ ...result, error: "No image media id on that message" }, { status: 404 });
  }
  result.media_id = image.id;

  try {
    const { buffer, mimeType } = await fetchWhatsAppMedia(image.id);
    result.media_download = { ok: true, bytes: buffer.length, mimeType };
    try {
      const description = await describeIncomingImage({ buffer, mimeType: image.mime_type ?? mimeType });
      result.vision = { ok: true, description };
    } catch (visionErr) {
      result.vision = { ok: false, error: visionErr instanceof Error ? visionErr.message : String(visionErr) };
    }
  } catch (mediaErr) {
    result.media_download = { ok: false, error: mediaErr instanceof Error ? mediaErr.message : String(mediaErr) };
  }

  return NextResponse.json(result);
}
