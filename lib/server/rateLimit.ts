import "server-only";

import { PaymentError } from "@/lib/server/paymentErrors";

interface Bucket {
  count: number;
  resetAt: number;
}

const globalForRateLimit = globalThis as typeof globalThis & {
  __solidRateLimits?: Map<string, Bucket>;
};

const buckets = globalForRateLimit.__solidRateLimits ?? new Map<string, Bucket>();
globalForRateLimit.__solidRateLimits = buckets;

export function enforceRateLimit(key: string, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > limit) {
    throw new PaymentError(
      "INVALID_REQUEST",
      "Too many requests. Please wait and try again.",
      429
    );
  }
}
