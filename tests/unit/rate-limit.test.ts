import { describe, expect, it } from "vitest";

import { TooManyAttemptsError } from "@/lib/errors";
import { createRateLimiter, sharedRateLimiter } from "@/lib/rate-limit";
import { assertNotThrottled, recordFailedAttempt } from "@/modules/auth/throttle";

function clock(start = 1_000_000) {
  let current = start;
  return { now: () => current, advance: (ms: number) => (current += ms) };
}

describe("createRateLimiter", () => {
  it("lets failures through until the maximum and blocks the next attempt", () => {
    const time = clock();
    const limiter = createRateLimiter({ max: 3, windowMs: 60_000 }, time.now);
    for (let i = 0; i < 3; i += 1) {
      expect(limiter.check("1.2.3.4")).toEqual({ blocked: false });
      limiter.recordFailure("1.2.3.4");
    }
    expect(limiter.check("1.2.3.4")).toEqual({ blocked: true, retryAfterSeconds: 60 });
  });

  it("does not count attempts that were not recorded as failures", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 }, clock().now);
    for (let i = 0; i < 10; i += 1) {
      expect(limiter.check("1.2.3.4").blocked).toBe(false);
    }
  });

  it("keeps each key apart", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 }, clock().now);
    limiter.recordFailure("a");
    expect(limiter.check("a").blocked).toBe(true);
    expect(limiter.check("b").blocked).toBe(false);
  });

  it("reports the time left from the oldest failure and frees the key when the window passes", () => {
    const time = clock();
    const limiter = createRateLimiter({ max: 2, windowMs: 60_000 }, time.now);
    limiter.recordFailure("a");
    time.advance(20_000);
    limiter.recordFailure("a");
    time.advance(10_000);
    // la más vieja ocurrió hace 30 s: faltan 30 s para que se libere un lugar
    expect(limiter.check("a")).toEqual({ blocked: true, retryAfterSeconds: 30 });
    time.advance(30_000);
    expect(limiter.check("a")).toEqual({ blocked: false });
  });

  it("forgets a key on reset", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 }, clock().now);
    limiter.recordFailure("a");
    limiter.reset("a");
    expect(limiter.check("a").blocked).toBe(false);
  });

  it("sweeps expired keys so memory cannot grow without bound", () => {
    const time = clock();
    const limiter = createRateLimiter({ max: 1, windowMs: 1_000 }, time.now);
    for (let i = 0; i < 5_000; i += 1) {
      limiter.recordFailure(`ip-${i}`);
    }
    time.advance(2_000);
    limiter.recordFailure("fresh"); // dispara el barrido
    expect(limiter.check("ip-0").blocked).toBe(false);
    expect(limiter.check("fresh").blocked).toBe(true);
  });
});

describe("sharedRateLimiter", () => {
  it("returns the same limiter for the same name", () => {
    const options = { max: 1, windowMs: 1_000 };
    expect(sharedRateLimiter("same", options)).toBe(sharedRateLimiter("same", options));
    expect(sharedRateLimiter("same", options)).not.toBe(sharedRateLimiter("other", options));
  });
});

describe("login throttle", () => {
  it("blocks an IP after too many failures, with the wait time, and spares other IPs", () => {
    const limiter = createRateLimiter({ max: 2, windowMs: 60_000 }, clock().now);
    recordFailedAttempt("9.9.9.9", "INVALID_CREDENTIALS", limiter);
    recordFailedAttempt("9.9.9.9", "ACCOUNT_LOCKED", limiter);
    expect(() => assertNotThrottled("9.9.9.9", limiter)).toThrow(TooManyAttemptsError);
    try {
      assertNotThrottled("9.9.9.9", limiter);
    } catch (error) {
      expect((error as TooManyAttemptsError).retryAfterSeconds).toBe(60);
    }
    expect(() => assertNotThrottled("8.8.8.8", limiter)).not.toThrow();
  });

  it("groups requests with no usable IP under one key", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 }, clock().now);
    recordFailedAttempt(undefined, "INVALID_CREDENTIALS", limiter);
    expect(() => assertNotThrottled(undefined, limiter)).toThrow(TooManyAttemptsError);
  });
});
