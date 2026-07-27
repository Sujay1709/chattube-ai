/**
 * ratelimit.ts — a tiny in-memory, per-IP sliding-window rate limiter.
 *
 * Goal: stop a stranger on your public URL from hammering the API and burning
 * your free OpenRouter quota.
 *
 * IMPORTANT (honest caveat): on Vercel each serverless instance has its OWN
 * memory, so this counter isn't shared across instances — it's a best-effort
 * guard that blocks casual abuse, not a strict global cap. For a hard limit
 * across all instances, back it with Upstash Redis + @upstash/ratelimit (free
 * tier); see the README. For a learning project shared with friends, this is
 * plenty.
 */

type Timestamps = number[];
const store = new Map<string, Timestamps>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const cutoff = now - windowMs;
  const hits = (store.get(key) || []).filter((t) => t > cutoff);

  if (hits.length >= limit) {
    store.set(key, hits);
    const retryAfterSec = Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
    return { ok: false, remaining: 0, retryAfterSec };
  }

  hits.push(now);
  store.set(key, hits);

  // Opportunistic cleanup so the Map can't grow unbounded.
  if (store.size > 5000) {
    for (const [k, v] of store) {
      const fresh = v.filter((t) => t > cutoff);
      if (fresh.length === 0) store.delete(k);
      else store.set(k, fresh);
    }
  }

  return { ok: true, remaining: limit - hits.length, retryAfterSec: 0 };
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}
