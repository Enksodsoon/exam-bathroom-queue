import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  checkRateLimit,
  enforceRateLimit,
  getClientIp,
  resetInMemoryRateLimitForTest,
} from "../../src/lib/api/rateLimit";

describe("rateLimit", () => {
  beforeEach(() => {
    resetInMemoryRateLimitForTest();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.EXAMQ_DISABLE_RATE_LIMIT;
  });

  it("extracts client IP from x-real-ip or x-forwarded-for", () => {
    const req1 = new NextRequest("http://localhost/api/sessions", {
      headers: { "x-real-ip": "203.0.113.10" },
    });
    expect(getClientIp(req1)).toBe("203.0.113.10");

    const req2 = new NextRequest("http://localhost/api/sessions", {
      headers: { "x-forwarded-for": "198.51.100.2, 10.0.0.1" },
    });
    expect(getClientIp(req2)).toBe("198.51.100.2");
  });

  it("enforces fixed-window limits per IP and bucket and returns 429 with Retry-After", async () => {
    const now = 1_700_000_000_000;
    const r1 = await checkRateLimit({
      bucket: "test-bucket",
      ip: "1.2.3.4",
      limit: 2,
      windowSeconds: 60,
      nowMs: now,
    });
    const r2 = await checkRateLimit({
      bucket: "test-bucket",
      ip: "1.2.3.4",
      limit: 2,
      windowSeconds: 60,
      nowMs: now + 1000,
    });
    const r3 = await checkRateLimit({
      bucket: "test-bucket",
      ip: "1.2.3.4",
      limit: 2,
      windowSeconds: 60,
      nowMs: now + 2000,
    });
    const otherIp = await checkRateLimit({
      bucket: "test-bucket",
      ip: "5.6.7.8",
      limit: 2,
      windowSeconds: 60,
      nowMs: now + 2000,
    });

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(false);
    expect(r3.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(otherIp.allowed).toBe(true);

    const req = new NextRequest("http://localhost/api/sessions", {
      method: "POST",
      headers: { "x-real-ip": "9.9.9.9" },
    });
    expect(
      await enforceRateLimit(req, {
        bucket: "api-test",
        limit: 1,
        windowSeconds: 60,
      }),
    ).toBeNull();
    const blocked = await enforceRateLimit(req, {
      bucket: "api-test",
      limit: 1,
      windowSeconds: 60,
    });
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get("Retry-After"))).toBeGreaterThanOrEqual(
      1,
    );
  });
});
