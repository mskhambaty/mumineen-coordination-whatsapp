import type { NextRequest } from "next/server";

import { createPasswordResetToken } from "@/lib/admin/passwords";
import { optionalEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const PRODUCTION_APP_URL = "https://www.chicagorelaycenter.com";

export function getAppUrl(req?: NextRequest): string {
  const configuredUrl = optionalEnv("NEXT_PUBLIC_APP_URL");
  if (configuredUrl) return configuredUrl.replace(/\/+$/, "");

  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;

  const forwardedHost = req?.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const forwardedProto = req?.headers.get("x-forwarded-proto") ?? "https";
    return `${forwardedProto}://${forwardedHost}`;
  }

  return req?.nextUrl.origin ?? PRODUCTION_APP_URL;
}

export function buildPasswordResetUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, "")}/admin/reset-password?token=${encodeURIComponent(token)}`;
}

export async function issuePasswordResetLink(userId: string, appUrl: string) {
  const { token, tokenHash } = createPasswordResetToken();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString();

  const { error } = await getSupabaseAdmin()
    .from("whatsapp_users")
    .update({
      password_reset_token_hash: tokenHash,
      password_reset_expires_at: expiresAt,
    })
    .eq("id", userId);

  if (error) {
    throw new Error(`Failed to store password reset token: ${error.message}`);
  }

  return {
    token,
    tokenHash,
    expiresAt,
    url: buildPasswordResetUrl(appUrl, token),
  };
}
