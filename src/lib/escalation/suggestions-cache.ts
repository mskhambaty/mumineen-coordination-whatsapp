const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

type CacheEntry<T> = { data: T; expiry: number };

const store = new Map<string, CacheEntry<unknown>>();

export function getCached<T>(phone: string): T | null {
  const entry = store.get(phone);
  if (!entry || Date.now() > entry.expiry) {
    store.delete(phone);
    return null;
  }
  return entry.data as T;
}

export function setCached<T>(phone: string, data: T): void {
  store.set(phone, { data, expiry: Date.now() + CACHE_TTL_MS });
}

export function invalidate(phone: string): void {
  store.delete(phone);
}
