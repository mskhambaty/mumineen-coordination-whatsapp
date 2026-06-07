// src/lib/admin/client.ts
// Client-side helpers for the admin portal. The session lives in an httpOnly
// cookie attached automatically by the browser; localStorage holds only the
// non-sensitive user object for UI gating.
import { PortalUser } from "@/lib/admin/access";

export type StoredAdminUser = PortalUser & {
  id?: string;
  display_name?: string | null;
  email?: string | null;
};

export function readAdminUser(): StoredAdminUser | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(window.localStorage.getItem("admin_user") ?? "null") as StoredAdminUser | null;
  } catch {
    return null;
  }
}

export function clearAdminSession(): void {
  window.localStorage.removeItem("admin_user");
  window.localStorage.removeItem("admin_token"); // legacy key from the pre-cookie era
}

// Drop-in replacement for the per-page apiFetch wrappers. On 401 (expired or
// missing session) it clears stale local state and bounces to the login page.
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && !(init?.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    clearAdminSession();
    window.location.href = "/admin/login";
  }
  return res;
}
