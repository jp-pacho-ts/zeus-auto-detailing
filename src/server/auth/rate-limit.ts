import "server-only";

// In-process limits. Correct only while one application process serves traffic
// (the T-027 single-replica invariant); scaling out needs a shared limiter.
//
// Key tables are bounded (P1-10 M3) and never forget a key whose window can still limit it, so
// no client can reset another client's counts (Codex F1, PM ruling 2026-10-21). A key is
// forgotten only once all its windows have ended and nothing is in flight. When every tracked
// key is live, only a new key is refused, until the earliest window ends: at most 60 s for the
// minute-only limiters. Tracked keys keep their counts and keep working.
const MAX_KEYS = 100_000;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const PRUNE_INTERVAL_MS = 1_000; // a full scan at most once a second while the table is full

export type LimitEntry = { ok: true; leave: () => void } | { ok: false; retryAfterSeconds: number };

interface LoginKeyState { minuteStart: number; minuteCount: number; dayStart: number; dayCount: number; inFlight: number }

const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

export function createLoginLimiter(
  policy: { perKeyPerMinute: number; perKeyPerDay: number | null; maxConcurrentPerKey: number },
  now: () => number = Date.now,
  maxKeys = MAX_KEYS,
) {
  const keys = new Map<string, LoginKeyState>();
  const window = (start: number, length: number, t: number) => Math.ceil((start + length - t) / 1000);
  // When a key's last window ends; Infinity while a request is in flight.
  const expiry = (s: LoginKeyState) =>
    s.inFlight > 0 ? Infinity : Math.max(s.minuteStart + MINUTE_MS, policy.perKeyPerDay === null ? 0 : s.dayStart + DAY_MS);
  let lastPrune = -Infinity, earliest = Infinity;

  function hasRoom(t: number): boolean {
    if (keys.size < maxKeys) return true;
    if (t - lastPrune >= PRUNE_INTERVAL_MS || t >= earliest) {
      lastPrune = t; earliest = Infinity;
      for (const [k, s] of keys) {
        const end = expiry(s);
        if (end <= t) keys.delete(k); else earliest = Math.min(earliest, end);
      }
    }
    return keys.size < maxKeys;
  }

  return {
    enter(key: string): LimitEntry {
      const t = now();
      let state = keys.get(key);
      if (!state) {
        if (!hasRoom(t)) return { ok: false, retryAfterSeconds: earliest === Infinity ? 1 : seconds(earliest - t) };
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
    size: () => keys.size,
  };
}

// Fixed-window counter: unknown-token session lookups per trusted client key. Same table rule:
// a live window is never dropped; while every window is live, a new key is blocked (it could
// not be counted) until the earliest one ends.
export function createWindowCounter(limit: number, windowMs: number, now: () => number = Date.now, maxKeys = MAX_KEYS) {
  const keys = new Map<string, { start: number; count: number }>();
  const current = (key: string, t: number) => {
    const s = keys.get(key);
    return s && s.start + windowMs > t ? s : null;
  };
  let lastPrune = -Infinity, earliest = Infinity;
  const hasRoom = (t: number) => {
    if (keys.size < maxKeys) return true;
    if (t - lastPrune >= PRUNE_INTERVAL_MS || t >= earliest) {
      lastPrune = t; earliest = Infinity;
      for (const [k, v] of keys) {
        if (v.start + windowMs <= t) keys.delete(k); else earliest = Math.min(earliest, v.start + windowMs);
      }
    }
    return keys.size < maxKeys;
  };
  return {
    blocked(key: string): boolean {
      const t = now();
      const s = current(key, t);
      if (s) return s.count >= limit;
      return !keys.has(key) && !hasRoom(t);
    },
    record(key: string): void {
      const t = now();
      const s = current(key, t);
      if (s) { s.count++; return; }
      if (keys.has(key) || hasRoom(t)) keys.set(key, { start: t, count: 1 }); // an expired entry restarts in place
    },
    size: () => keys.size,
  };
}
