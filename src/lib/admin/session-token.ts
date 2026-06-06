import { createHmac, timingSafeEqual } from "node:crypto";

import { optionalEnv, requireEnv } from "@/lib/env";

export const SESSION_COOKIE_NAME = "portal_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

type SessionPayload = { user_id: string; exp: number };

// Dedicated secret when configured; falls back to ADMIN_API_KEY so the deploy
// doesn't break before SESSION_SECRET is set in Vercel.
function signingSecret(): string {
  return optionalEnv("SESSION_SECRET") ?? requireEnv("ADMIN_API_KEY");
}

function hmac(payloadB64: string): Buffer {
  return createHmac("sha256", signingSecret()).update(payloadB64).digest();
}

export function signSessionToken(userId: string, ttlSeconds = SESSION_TTL_SECONDS): string {
  const payload: SessionPayload = { user_id: userId, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${payloadB64}.${hmac(payloadB64).toString("base64url")}`;
}

export function verifySessionToken(token: string): { user_id: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payloadB64, sigB64] = parts;

  let providedSig: Buffer;
  try {
    providedSig = Buffer.from(sigB64, "base64url");
  } catch {
    return null;
  }
  const expectedSig = hmac(payloadB64);
  if (providedSig.length !== expectedSig.length || !timingSafeEqual(providedSig, expectedSig)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.user_id !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return { user_id: payload.user_id };
  } catch {
    return null;
  }
}

// Shared cookie options for login / reset / logout. secure is dev-friendly.
export function sessionCookieOptions(maxAge = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
