import "server-only";

// In-process limits. Correct only while one application process serves traffic
// (the T-027 single-replica invariant); scaling out needs a shared limiter.
//
// Key tables are bounded (P1-10 M3). A key is forgotten once none of its windows can limit it
// any more. When the table is still full, the least recently used idle key makes room, so many
// distinct clients never lock out a new one. Every attempt, admitted or refused, counts as use,
// so a client that keeps trying keeps its counts.
const MAX_KEYS = 10_000;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const PRUNE_INTERVAL_MS = 1_000; // a full scan at most once a second while the table is full

export type LimitEntry = { ok: true; leave: () => void } | { ok: false; retryAfterSeconds: number };

interface LoginKeyState { minuteStart: number; minuteCount: number; dayStart: number; dayCount: number; inFlight: number }

export function createLoginLimiter(
  policy: { perKeyPerMinute: number; perKeyPerDay: number | null; maxConcurrentPerKey: number },
  now: () => number = Date.now,
  maxKeys = MAX_KEYS,
) {
  const keys = new Map<string, LoginKeyState>(); // least recently used first
  const window = (start: number, length: number, t: number) => Math.ceil((start + length - t) / 1000);
  const expired = (s: LoginKeyState, t: number) =>
    s.inFlight === 0 && s.minuteStart + MINUTE_MS <= t && (policy.perKeyPerDay === null || s.dayStart + DAY_MS <= t);
  let lastPrune = -Infinity;

  function makeRoom(t: number): boolean {
    if (t - lastPrune >= PRUNE_INTERVAL_MS) {
      lastPrune = t;
      for (const [k, s] of keys) if (expired(s, t)) keys.delete(k);
    }
    if (keys.size < maxKeys) return true;
    for (const [k, s] of keys) if (s.inFlight === 0) { keys.delete(k); return true; }
    return false; // every tracked key has a request in flight
  }

  return {
    enter(key: string): LimitEntry {
      const t = now();
      let state = keys.get(key);
      if (state) keys.delete(key);
      else {
        if (keys.size >= maxKeys && !makeRoom(t)) return { ok: false, retryAfterSeconds: 1 };
        state = { minuteStart: t, minuteCount: 0, dayStart: t, dayCount: 0, inFlight: 0 };
      }
      keys.set(key, state);
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
    size: () => keys.size,
  };
}

// Fixed-window counter: unknown-token session lookups per trusted client key.
export function createWindowCounter(limit: number, windowMs: number, now: () => number = Date.now, maxKeys = MAX_KEYS) {
  const keys = new Map<string, { start: number; count: number }>(); // oldest window first
  const current = (key: string, t: number) => {
    const s = keys.get(key);
    return s && s.start + windowMs > t ? s : null;
  };
  let lastPrune = -Infinity;
  const makeRoom = (t: number) => {
    if (t - lastPrune >= PRUNE_INTERVAL_MS) {
      lastPrune = t;
      for (const [k, v] of keys) if (v.start + windowMs <= t) keys.delete(k);
    }
    if (keys.size >= maxKeys) keys.delete(keys.keys().next().value!);
  };
  return {
    // A key without a live window is never blocked; a full table drops its oldest window.
    blocked(key: string): boolean {
      const s = current(key, now());
      return s ? s.count >= limit : false;
    },
    record(key: string): void {
      const t = now();
      const s = current(key, t);
      if (s) { s.count++; return; }
      keys.delete(key);
      if (keys.size >= maxKeys) makeRoom(t);
      keys.set(key, { start: t, count: 1 });
    },
    size: () => keys.size,
  };
}
