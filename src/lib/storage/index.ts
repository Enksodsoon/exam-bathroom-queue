import { FileSessionStore, resolveFileStoreDataDir } from "./fileStore";
import { UpstashRedisSessionStore } from "./redisStore";
import {
  StorageError,
  type SessionStore,
  type StorageHealth,
} from "./types";

interface ResolvedStorageConfig {
  key: string;
  health: StorageHealth;
  dataDir?: string;
}

let cachedStore: { key: string; store: SessionStore } | null = null;

function resolveStorageConfig(): ResolvedStorageConfig {
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL?.trim() || "";
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || "";
  const kvUrl = process.env.KV_REST_API_URL?.trim() || "";
  const kvToken = process.env.KV_REST_API_TOKEN?.trim() || "";

  if (upstashUrl && upstashToken) {
    const prefixKey = `${process.env.EXAMQ_REDIS_PREFIX ?? ""}:${process.env.VERCEL_ENV ?? "local"}`;
    return {
      key: `redis:${upstashUrl}:${upstashToken}:${prefixKey}`,
      health: { ok: true, storage: "upstash-redis" },
    };
  }

  if (kvUrl && kvToken) {
    const prefixKey = `${process.env.EXAMQ_REDIS_PREFIX ?? ""}:${process.env.VERCEL_ENV ?? "local"}`;
    return {
      key: `redis:${kvUrl}:${kvToken}:${prefixKey}`,
      health: { ok: true, storage: "upstash-redis" },
    };
  }

  const hasPartialRedisConfig =
    upstashUrl.length > 0 ||
    upstashToken.length > 0 ||
    kvUrl.length > 0 ||
    kvToken.length > 0;

  if (hasPartialRedisConfig) {
    return {
      key: "misconfigured:partial-redis",
      health: {
        ok: false,
        storage: "upstash-redis",
        error:
          "Incomplete Redis REST configuration: both URL and token must be provided.",
      },
    };
  }

  if (process.env.VERCEL === "1") {
    return {
      key: "misconfigured:vercel-no-redis",
      health: {
        ok: false,
        storage: "upstash-redis",
        error:
          "VERCEL=1 requires UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL + KV_REST_API_TOKEN).",
      },
    };
  }

  const dataDir = resolveFileStoreDataDir();
  return {
    key: `file:${dataDir}`,
    health: { ok: true, storage: "file" },
    dataDir,
  };
}

export function getStorageHealth(): StorageHealth {
  return resolveStorageConfig().health;
}

export function getSessionStore(): SessionStore {
  const config = resolveStorageConfig();
  if (!config.health.ok) {
    throw new StorageError(
      "STORAGE_MISCONFIGURED",
      config.health.error ?? "Storage backend is misconfigured",
    );
  }

  if (cachedStore && cachedStore.key === config.key) {
    return cachedStore.store;
  }

  const store: SessionStore =
    config.health.storage === "upstash-redis"
      ? new UpstashRedisSessionStore()
      : new FileSessionStore(config.dataDir);

  cachedStore = { key: config.key, store };
  return store;
}

export function resetSessionStoreForTests(): void {
  cachedStore = null;
}

export * from "./types";
export * from "./fileStore";
export * from "./redisStore";
