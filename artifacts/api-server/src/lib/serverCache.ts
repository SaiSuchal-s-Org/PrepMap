type CacheEntry<T> = {
  value: T;
  expiresAt: number;
  updatedAt: number;
};

const store = new Map<string, CacheEntry<unknown>>();

const stats = {
  hit: 0,
  miss: 0,
  set: 0,
  del: 0,
  sweep: 0,
};

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let sweepTimer: ReturnType<typeof setInterval> | null = null;

function nowMs(): number {
  return Date.now();
}

function ensureSweepTimer() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = nowMs();
    let removed = 0;
    for (const [key, entry] of store.entries()) {
      if (entry.expiresAt <= now) {
        store.delete(key);
        removed += 1;
      }
    }
    if (removed > 0) stats.sweep += removed;
  }, SWEEP_INTERVAL_MS);
  // Do not keep the process alive for cache sweeping.
  if (typeof (sweepTimer as any).unref === "function") {
    (sweepTimer as any).unref();
  }
}

ensureSweepTimer();

export const cacheTtlMs = {
  metadata: 24 * 60 * 60 * 1000,
  configs: 24 * 60 * 60 * 1000,
  nodes: 24 * 60 * 60 * 1000,
  topicBundle: 24 * 60 * 60 * 1000,
  questionBank: 24 * 60 * 60 * 1000,
} as const;

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) {
    stats.miss += 1;
    return null;
  }
  if (entry.expiresAt <= nowMs()) {
    store.delete(key);
    stats.miss += 1;
    return null;
  }
  stats.hit += 1;
  return entry.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): T {
  const now = nowMs();
  store.set(key, {
    value,
    updatedAt: now,
    expiresAt: now + Math.max(1, ttlMs),
  });
  stats.set += 1;
  return value;
}

export async function cacheGetOrSet<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const cached = cacheGet<T>(key);
  if (cached !== null) return cached;
  const next = await loader();
  return cacheSet(key, next, ttlMs);
}

export function cacheDelete(key: string): void {
  if (store.delete(key)) stats.del += 1;
}

export function cacheDeleteByPrefix(prefix: string): number {
  let removed = 0;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      removed += 1;
    }
  }
  if (removed > 0) stats.del += removed;
  return removed;
}

export function cacheStats() {
  return {
    size: store.size,
    ...stats,
  };
}

export function isLiveStatus(value: string | null | undefined): boolean {
  return String(value || "").trim().toLowerCase() === "live";
}

