import { createClient } from "redis";

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
  updatedAt: number;
};

const stats = {
  hit: 0,
  miss: 0,
  redisHit: 0,
  redisMiss: 0,
  redisErr: 0,
  set: 0,
  del: 0,
  sweep: 0,
};

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let redisClient: any = null;
let redisReady = false;
let redisInitAttempted = false;

function nowMs(): number {
  return Date.now();
}

function getRedisUrl(): string | null {
  const raw = String(process.env.REDIS_URL || "").trim();
  if (!raw) return null;
  return raw;
}

function initRedisIfNeeded() {
  if (redisInitAttempted) return;
  redisInitAttempted = true;
  const redisUrl = getRedisUrl();
  if (!redisUrl) return;

  const client = createClient({
    url: redisUrl,
    socket: {
      reconnectStrategy: (retries: number) => Math.min(500 * retries, 5000),
    },
  });

  client.on("ready", () => {
    redisReady = true;
  });
  client.on("end", () => {
    redisReady = false;
  });
  client.on("error", () => {
    redisReady = false;
    stats.redisErr += 1;
  });

  redisClient = client;
  void client.connect().catch(() => {
    stats.redisErr += 1;
  });
}

function getRedisClientReady(): any | null {
  initRedisIfNeeded();
  if (!redisClient || !redisReady) return null;
  return redisClient;
}

export const cacheTtlMs = {
  metadata: 24 * 60 * 60 * 1000,
  configs: 24 * 60 * 60 * 1000,
  nodes: 24 * 60 * 60 * 1000,
  topicBundle: 24 * 60 * 60 * 1000,
  questionBank: 24 * 60 * 60 * 1000,
} as const;

export function cacheGet<T>(key: string): T | null {
  // Redis-only mode: this function is kept for compatibility.
  stats.miss += 1;
  return null;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): T {
  stats.set += 1;
  void cacheSetRedis(key, value, ttlMs);
  return value;
}

async function cacheGetRedis<T>(key: string): Promise<T | null> {
  const client = getRedisClientReady();
  if (!client) return null;
  try {
    const raw = await client.get(key);
    if (!raw) {
      stats.redisMiss += 1;
      return null;
    }
    stats.redisHit += 1;
    return JSON.parse(raw) as T;
  } catch {
    stats.redisErr += 1;
    return null;
  }
}

async function cacheSetRedis<T>(key: string, value: T, ttlMs: number): Promise<void> {
  const client = getRedisClientReady();
  if (!client) return;
  try {
    const ttlSec = Math.max(1, Math.floor(ttlMs / 1000));
    await client.set(key, JSON.stringify(value), { EX: ttlSec });
  } catch {
    stats.redisErr += 1;
  }
}

export async function cacheGetOrSet<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const redisCached = await cacheGetRedis<T>(key);
  if (redisCached !== null) {
    stats.hit += 1;
    return redisCached;
  }

  stats.miss += 1;
  const next = await loader();
  return cacheSet(key, next, ttlMs);
}

export function cacheDelete(key: string): void {
  stats.del += 1;
  void cacheDeleteRedis(key);
}

export function cacheDeleteByPrefix(prefix: string): number {
  void cacheDeleteByPrefixRedis(prefix);
  return 0;
}

async function cacheDeleteRedis(key: string): Promise<void> {
  const client = getRedisClientReady();
  if (!client) return;
  try {
    await client.del(key);
  } catch {
    stats.redisErr += 1;
  }
}

async function cacheDeleteByPrefixRedis(prefix: string): Promise<void> {
  const client = getRedisClientReady();
  if (!client) return;
  try {
    const keys = await client.keys(`${prefix}*`);
    if (keys.length > 0) {
      await client.del(keys);
    }
  } catch {
    stats.redisErr += 1;
  }
}

export function cacheStats() {
  return {
    backend: getRedisUrl() ? "redis-only" : "memory-only",
    size: 0,
    ...stats,
  };
}

export function cacheHealth() {
  const redisUrl = getRedisUrl();
  const enabled = !!redisUrl;
  return {
    backend: enabled ? "redis-only" : "memory-only",
    memoryReadBypass: false,
    redis: {
      enabled,
      ready: enabled ? redisReady : false,
    },
    memory: {
      size: 0,
    },
  };
}

export function isLiveStatus(value: string | null | undefined): boolean {
  return String(value || "").trim().toLowerCase() === "live";
}

