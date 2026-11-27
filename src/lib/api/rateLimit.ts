import { NextResponse, type NextRequest } from "next/server";

export interface RateLimitOptions {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface MemoryEntry {
  count: number;
  resetAtMs: number;
}

const memoryStore = new Map<string, MemoryEntry>();

export function resetInMemoryRateLimitForTest(): void {
  memoryStore.clear();
}

export function getClientIp(request: NextRequest): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }
  const forwarded = request.headers.get("x-forwarded-for")?.trim();
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  return "local";
}

function getRedisConfig(): { url: string; token: string } | null {
  const url = (
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    ""
  ).trim();
  const token = (
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    ""
  ).trim();
  if (!url || !token) {
    return null;
  }
  return { url: url.replace(/\/+$/, ""), token };
}

function checkMemoryRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  nowMs: number,
): RateLimitResult {
  if (memoryStore.size > 2000) {
    for (const [k, v] of memoryStore.entries()) {
      if (v.resetAtMs <= nowMs) {
        memoryStore.delete(k);
      }
    }
  }

  const windowMs = windowSeconds * 1000;
  const existing = memoryStore.get(key);
  if (!existing || existing.resetAtMs <= nowMs) {
    memoryStore.set(key, { count: 1, resetAtMs: nowMs + windowMs });
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      retryAfterSeconds: windowSeconds,
    };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((existing.resetAtMs - nowMs) / 1000),
  );
  if (existing.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds,
  };
}

export async function checkRateLimit(
  params: RateLimitOptions & { ip: string; nowMs?: number },
): Promise<RateLimitResult> {
  const nowMs = params.nowMs ?? Date.now();
  const windowIndex = Math.floor(nowMs / (params.windowSeconds * 1000));
  const key = `examq:rl:${params.bucket}:${params.ip}:${windowIndex}`;
  const redis = getRedisConfig();

  if (!redis) {
    return checkMemoryRateLimit(key, params.limit, params.windowSeconds, nowMs);
  }

  try {
    const res = await fetch(`${redis.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redis.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, String(params.windowSeconds + 5), "NX"],
      ]),
      cache: "no-store",
    });

    if (!res.ok) {
      return {
        allowed: true,
        remaining: params.limit,
        retryAfterSeconds: params.windowSeconds,
      };
    }

    const data = (await res.json()) as Array<{ result?: unknown }>;
    const count = Number(data?.[0]?.result ?? 1);
    if (!Number.isFinite(count)) {
      return {
        allowed: true,
        remaining: params.limit,
        retryAfterSeconds: params.windowSeconds,
      };
    }

    const windowEndMs = (windowIndex + 1) * params.windowSeconds * 1000;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((windowEndMs - nowMs) / 1000),
    );

    return {
      allowed: count <= params.limit,
      remaining: Math.max(0, params.limit - count),
      retryAfterSeconds,
    };
  } catch {
    // Fail open so transient Redis issues never block an active exam hall.
    return {
      allowed: true,
      remaining: params.limit,
      retryAfterSeconds: params.windowSeconds,
    };
  }
}

export async function enforceRateLimit(
  request: NextRequest,
  options: RateLimitOptions,
): Promise<NextResponse | null> {
  if (process.env.EXAMQ_DISABLE_RATE_LIMIT === "1") {
    return null;
  }

  const ip = getClientIp(request);
  const result = await checkRateLimit({ ...options, ip });
  if (result.allowed) {
    return null;
  }

  return NextResponse.json(
    {
      error: "Too many requests. Please wait a moment and try again.",
      code: "RATE_LIMITED",
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        "Cache-Control": "no-store",
      },
    },
  );
}
