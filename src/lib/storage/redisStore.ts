import { Redis } from "@upstash/redis";
import type { ExamSession } from "@/lib/domain";
import {
  assertValidSessionId,
  parseStoredSession,
  StorageError,
  type MutateResult,
  type SessionMutator,
  type SessionStore,
} from "./types";

export const SESSION_TTL_SECONDS = 86_400;
const DEFAULT_MAX_RETRIES = 24;

function resolveDefaultKeyPrefix(): string {
  const explicit = process.env.EXAMQ_REDIS_PREFIX?.trim();
  if (explicit) {
    return explicit.endsWith(":") ? explicit : `${explicit}:`;
  }
  const env = process.env.VERCEL_ENV?.trim();
  return env ? `examq:${env}:session:` : "examq:session:";
}

const CAS_LUA_SCRIPT = `
local current = redis.call("GET", KEYS[1])
if not current then
  return -1
end
local ok, decoded = pcall(cjson.decode, current)
if not ok or type(decoded) ~= "table" then
  return -2
end
if tonumber(decoded["version"]) ~= tonumber(ARGV[1]) then
  return 0
end
redis.call("SET", KEYS[1], ARGV[2], "EX", tonumber(ARGV[3]))
return 1
`.trim();

export interface RedisLike {
  get<TData = unknown>(key: string): Promise<TData | null>;
  set<TData = unknown>(
    key: string,
    value: TData,
    opts?: { ex: number } | { ex: number; nx: true },
  ): Promise<"OK" | TData | null>;
  eval<TArgs extends unknown[], TData = unknown>(
    script: string,
    keys: string[],
    args: TArgs,
  ): Promise<TData>;
  del?(...keys: string[]): Promise<number>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveEnvRedisCredentials(): { url: string; token: string } {
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL?.trim() || "";
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || "";
  if (upstashUrl && upstashToken) {
    return { url: upstashUrl, token: upstashToken };
  }

  const kvUrl = process.env.KV_REST_API_URL?.trim() || "";
  const kvToken = process.env.KV_REST_API_TOKEN?.trim() || "";
  if (kvUrl && kvToken) {
    return { url: kvUrl, token: kvToken };
  }

  throw new StorageError(
    "STORAGE_MISCONFIGURED",
    "Redis backend requires UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN or KV_REST_API_URL + KV_REST_API_TOKEN",
  );
}

export class UpstashRedisSessionStore implements SessionStore {
  public readonly backendName = "upstash-redis" as const;
  private readonly redis: RedisLike;
  private readonly keyPrefix: string;
  private readonly maxRetries: number;

  constructor(options?: {
    redis?: RedisLike;
    keyPrefix?: string;
    maxRetries?: number;
  }) {
    if (options?.redis) {
      this.redis = options.redis;
    } else {
      const { url, token } = resolveEnvRedisCredentials();
      this.redis = new Redis({ url, token });
    }
    this.keyPrefix = options?.keyPrefix ?? resolveDefaultKeyPrefix();
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async ping(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        this.redis.get(`${this.keyPrefix}__healthcheck__`),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Redis ping timed out")),
            2_000,
          );
        }),
      ]);
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
    }
  }

  private keyFor(sessionId: string): string {
    const id = assertValidSessionId(sessionId);
    return `${this.keyPrefix}${id}`;
  }

  async create(session: ExamSession): Promise<ExamSession> {
    const key = this.keyFor(session.id);
    const payload = JSON.stringify(session);
    const res = await this.redis.set(key, payload, {
      ex: SESSION_TTL_SECONDS,
      nx: true,
    });
    if (res !== "OK") {
      throw new StorageError(
        "ALREADY_EXISTS",
        `Session '${session.id}' already exists`,
      );
    }
    return parseStoredSession(payload);
  }

  async get(sessionId: string): Promise<ExamSession | null> {
    const key = this.keyFor(sessionId);
    const raw = await this.redis.get<ExamSession | string>(key);
    if (raw === null || raw === undefined) {
      return null;
    }
    return parseStoredSession(raw);
  }

  async mutate<T>(
    sessionId: string,
    mutator: SessionMutator<T>,
  ): Promise<MutateResult<T>> {
    const key = this.keyFor(sessionId);

    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      const current = await this.get(sessionId);
      if (!current) {
        throw new StorageError("NOT_FOUND", `Session '${sessionId}' not found`);
      }

      const { session: nextSession, result } = mutator(current);
      const status = await this.redis.eval<[number, string, number], number>(
        CAS_LUA_SCRIPT,
        [key],
        [
          current.version,
          JSON.stringify(nextSession),
          SESSION_TTL_SECONDS,
        ],
      );

      if (status === 1) {
        return { session: nextSession, result };
      }
      if (status === -1) {
        throw new StorageError("NOT_FOUND", `Session '${sessionId}' not found`);
      }
      if (status === -2) {
        throw new StorageError(
          "CORRUPT_DATA",
          `Stored session '${sessionId}' is corrupt`,
        );
      }
      if (status !== 0) {
        throw new StorageError(
          "CORRUPT_DATA",
          `Unexpected CAS result code '${String(status)}' for session '${sessionId}'`,
        );
      }

      if (attempt + 1 < this.maxRetries) {
        const capMs = Math.min(150, Math.round(8 * Math.pow(1.4, attempt)));
        const delayMs = 2 + Math.floor(Math.random() * capMs);
        await sleep(delayMs);
      }
    }

    throw new StorageError(
      "CONFLICT",
      `Concurrent update conflict on session '${sessionId}' after ${this.maxRetries} attempts`,
    );
  }

  async delete(sessionId: string): Promise<boolean> {
    const key = this.keyFor(sessionId);
    if (typeof this.redis.del === "function") {
      const removed = await this.redis.del(key);
      return removed > 0;
    }
    return false;
  }
}
