import "server-only";

// In-process limits. Correct only while one application process serves traffic
// (the T-027 single-replica invariant); scaling out needs a shared limiter.
const MAX_KEYS = 10_000;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export type LimitEntry = { ok: true; leave: () => void } | { ok: false; retryAfterSeconds: number };

interface LoginKeyState { minuteStart: number; minuteCount: number; dayStart: number; dayCount: number; inFlight: number }

export function createLoginLimiter(
  policy: { perKeyPerMinute: number; perKeyPerDay: number | null; maxConcurrentPerKey: number },
  now: () => number = Date.now,
  maxKeys = MAX_KEYS,
) {
  const keys = new Map<string, LoginKeyState>();
  const window = (start: number, length: number, t: number) => Math.ceil((start + length - t) / 1000);

  function prune(t: number) {
    for (const [k, s] of keys) if (s.inFlight === 0 && s.minuteStart + MINUTE_MS <= t && (policy.perKeyPerDay === null || s.dayStart + DAY_MS <= t)) keys.delete(k);
  }

  return {
    enter(key: string): LimitEntry {
      const t = now();
      let state = keys.get(key);
      if (!state) {
        if (keys.size >= maxKeys) prune(t);
        if (keys.size >= maxKeys) return { ok: false, retryAfterSeconds: 60 };
        state = { minuteStart: t, minuteCount: 0, dayStart: t, dayCount: 0, inFlight: 0 };
        keys.set(key, state);
      }
      if (state.minuteStart + MINUTE_MS <= t) { state.minuteStart = t; state.minuteCount = 0; }
      if (state.dayStart + DAY_MS <= t) { state.dayStart = t; state.dayCount = 0; }
      if (policy.perKeyPerDay !== null && state.dayCount >= policy.perKeyPerDay) return { ok: false, retryAfterSeconds: window(state.dayStart, DAY_MS, t) };
      if (state.minuteCount >= policy.perKeyPerMinute) return { ok: false, retryAfterSeconds: window(state.minuteStart, MINUTE_MS, t) };
      if (state.inFlight >= policy.maxConcurrentPerKey) return { ok: false, retryAfterSeconds: 1 };
      state.minuteCount++; state.dayCount++; state.inFlight++;
      const held = state;
      let left = false;
      return { ok: true, leave: () => { if (!left) { left = true; held.inFlight--; } } };
    },
  };
}

// Fixed-window counter: unknown-token session lookups per trusted client key.
export function createWindowCounter(limit: number, windowMs: number, now: () => number = Date.now, maxKeys = MAX_KEYS) {
  const keys = new Map<string, { start: number; count: number }>();
  const current = (key: string, t: number) => {
    const s = keys.get(key);
    return s && s.start + windowMs > t ? s : null;
  };
  const full = (t: number) => {
    if (keys.size < maxKeys) return false;
    for (const [k, v] of keys) if (v.start + windowMs <= t) keys.delete(k);
    return keys.size >= maxKeys;
  };
  return {
    // A table full of live keys blocks new keys rather than growing without bound.
    blocked(key: string): boolean {
      const t = now();
      const s = current(key, t);
      return s ? s.count >= limit : full(t);
    },
    record(key: string): void {
      const t = now();
      const s = current(key, t);
      if (s) s.count++;
      else if (!full(t)) keys.set(key, { start: t, count: 1 });
    },
  };
}
