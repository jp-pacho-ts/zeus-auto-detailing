// P1-06 staff authentication against an isolated loopback PostgreSQL database.
// Run with DATABASE_URL and T007_TEST_DATABASE_URL both set to a fresh migrated
// zeus_t007_* database (src/server/__tests__/README.md). Without it these tests skip.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import { after, before, test } from "node:test";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { hash as rawHash } from "@node-rs/argon2";
import { runtimeRoleUrl } from "../catalog-db.fixture";

const url = process.env.T007_TEST_DATABASE_URL;
const enabled = Boolean(url);
if (url) {
  // Under T007_SERVICE_ROLE the services (DATABASE_URL) run as zeus_app on the same database (P1-10 M1).
  const serviceUrl = process.env.T007_SERVICE_ROLE === "zeus_app" ? runtimeRoleUrl(url) : url;
  assert.equal(process.env.DATABASE_URL, serviceUrl, "DATABASE_URL must equal the isolated T007_TEST_DATABASE_URL");
  const parsed = new URL(url);
  assert.ok(["127.0.0.1", "localhost"].includes(parsed.hostname) && parsed.pathname.startsWith("/zeus_t007_"), "Use only an isolated local test database");
}
const skip = !enabled;
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
process.env.APP_ORIGIN = "http://localhost:3000";
process.env.CLIENT_IP_SOURCE = "PROXY_HOPS";
process.env.TRUSTED_PROXY_HOPS = "1";
const ORIGIN = "http://localhost:3000";
const COOKIE = "zeus-staff-session"; // loopback development name

// Loaded lazily so the DB-free suite never imports Prisma-bound modules without a DB.
type Mods = {
  login: typeof import("./login"); session: typeof import("./session"); credentials: typeof import("./credentials");
  semaphore: typeof import("./semaphore"); rateLimit: typeof import("./rate-limit"); log: typeof import("./log");
  trace: typeof import("./trace"); admission: typeof import("./db-admission"); guards: typeof import("./guards");
  cli: typeof import("./cli"); identity: typeof import("./client-identity");
  loginRoute: typeof import("@/app/api/admin/auth/login/route"); logoutRoute: typeof import("@/app/api/admin/auth/logout/route");
  sessionRoute: typeof import("@/app/api/admin/auth/session/route");
};
let m: Mods;
const events: { event: string; fields: Record<string, unknown> }[] = [];
before(async () => {
  if (!enabled) return;
  m = {
    login: await import("./login"), session: await import("./session"), credentials: await import("./credentials"),
    semaphore: await import("./semaphore"), rateLimit: await import("./rate-limit"), log: await import("./log"),
    trace: await import("./trace"), admission: await import("./db-admission"), guards: await import("./guards"),
    cli: await import("./cli"), identity: await import("./client-identity"),
    loginRoute: await import("@/app/api/admin/auth/login/route"), logoutRoute: await import("@/app/api/admin/auth/logout/route"),
    sessionRoute: await import("@/app/api/admin/auth/session/route"),
  };
  m.log.setAuthEventSink((event, fields) => events.push({ event, fields: { ...fields } }));
});
after(async () => { await db.$disconnect(); });

const PASSWORD = "plum orbit lantern seventy";
let ip = 1;
const nextIp = () => `198.51.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`;
const email = () => `staff-${randomUUID()}@example.test`;

async function createStaff(opts: { role?: "ADMIN" | "MANAGER" | "DETAILER"; password?: string | null; active?: boolean } = {}) {
  const address = email();
  if (opts.password === null) {
    const row = await db.staff.create({ data: { name: "No Login", phone: "", email: address, role: opts.role ?? "DETAILER" } });
    return { id: row.id, email: address };
  }
  const result = await m.credentials.setStaffPassword(db, { email: address, name: "Test Staff", role: opts.role ?? "ADMIN" }, opts.password ?? PASSWORD);
  assert.ok(result.ok, JSON.stringify(result));
  if (opts.active === false) assert.ok((await m.credentials.deactivateStaff(db, address)).ok);
  return { id: result.staffId, email: address };
}

function loginRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/admin/auth/login", {
    method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": nextIp(), ...headers },
  });
}
function cookieFrom(response: Response): string | null {
  const header = response.headers.get("set-cookie");
  const match = header && new RegExp(`${COOKIE}=([^;]*)`).exec(header);
  return match ? match[1] : null;
}
const serviceLogin = (deps: Parameters<typeof import("./login").createStaffLogin>[0] = {}) => m.login.createStaffLogin(deps);
const ctx = (carriedToken: string | null = null) => ({ clientKey: `test-${randomUUID()}`, carriedToken, startedAt: performance.now() });
async function credential(staffId: string) {
  return db.staffCredential.findUniqueOrThrow({ where: { staffId } });
}
async function resolve(token: string | null) {
  return m.session.resolveStaffSession(token, `resolve-${randomUUID()}`);
}
const is503 = (e: unknown) => (e as { status?: number }).status === 503;
async function waitFor(predicate: () => boolean | Promise<boolean>, what: string, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
// Another session's row lock, held until release(): makes a write wait inside its transaction.
async function holdLock(lock: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<unknown>) {
  let release!: () => void; const released = new Promise<void>((r) => { release = r; });
  let locked!: () => void; const held = new Promise<void>((r) => { locked = r; });
  const done = db.$transaction(async (tx) => { await lock(tx); locked(); await released; }, { timeout: 20_000 });
  await held;
  return async () => { release(); await done; };
}
// Other test files share this database, so match the waiting statement too.
const lockWaiters = async (fragment: string) => (await db.$queryRaw<{ n: number }[]>`
  SELECT count(*)::int AS n FROM pg_stat_activity
  WHERE datname = current_database() AND wait_event_type = 'Lock' AND position(${fragment} in query) > 0`)[0].n;
const activeStatements = async (fragment: string) => (await db.$queryRaw<{ n: number }[]>`
  SELECT count(*)::int AS n FROM pg_stat_activity
  WHERE datname = current_database() AND state = 'active' AND pid <> pg_backend_pid() AND position(${fragment} in query) > 0`)[0].n;

test("login succeeds, sets the session cookie and the session resolves with the live role", { skip }, async () => {
  const staff = await createStaff({ role: "MANAGER" });
  const response = await m.loginRoute.POST(loginRequest({ email: staff.email.toUpperCase(), password: PASSWORD }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const setCookie = response.headers.get("set-cookie")!;
  assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /SameSite=lax/i); assert.match(setCookie, /Path=\//);
  assert.doesNotMatch(setCookie, /Domain=/i);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.role, "ADMIN"); assert.equal(body.data.staffRole, "MANAGER");
  assert.equal(body.data.staffId, staff.id);
  assert.equal("sessionId" in body.data, false);
  const token = cookieFrom(response)!;
  const row = await db.staffSession.findUniqueOrThrow({ where: { tokenHash: m.session.hashSessionToken(token) } });
  assert.equal(row.credentialGeneration, 1);
  assert.equal(row.expiresAt.getTime() - row.createdAt.getTime(), 12 * 3600_000);
  assert.equal(row.idleExpiresAt.getTime() - row.createdAt.getTime(), 2 * 3600_000);
  assert.equal(await db.staffSession.count({ where: { tokenHash: token } }), 0); // never the raw token
  const session = await resolve(token);
  assert.equal(session?.subject, staff.id);
  assert.equal(session?.role, "ADMIN");
  // GET /api/admin/auth/session
  const view = await m.sessionRoute.GET(new NextRequest("http://localhost:3000/api/admin/auth/session", { headers: { cookie: `${COOKIE}=${token}` } }));
  assert.equal(view.status, 200);
  assert.equal((await view.json()).data.displayName, "Test Staff");
  assert.ok(events.some((e) => e.event === "auth.login_succeeded" && e.fields.staffId === staff.id));
});

test("every failure class gets the same 401 body and headers, no cookie, no earlier than the floor", { skip }, async () => {
  const active = await createStaff();
  const noCredential = await createStaff({ password: null });
  const inactive = await createStaff({ active: false });
  const locked = await createStaff();
  await db.staffCredential.update({ where: { staffId: locked.id }, data: { lockedUntil: new Date(Date.now() + 15 * 60_000) } });
  const cases: [string, unknown][] = [
    ["UNKNOWN", { email: email(), password: PASSWORD }],
    ["NO_CREDENTIAL", { email: noCredential.email, password: PASSWORD }],
    ["INACTIVE", { email: inactive.email, password: PASSWORD }],
    ["LOCKED (correct password)", { email: locked.email, password: PASSWORD }],
    ["WRONG_PASSWORD", { email: active.email, password: PASSWORD + "x" }],
  ];
  const seen: string[] = [];
  for (const [label, body] of cases) {
    const started = performance.now();
    const response = await m.loginRoute.POST(loginRequest(body));
    const elapsed = performance.now() - started;
    assert.equal(response.status, 401, label);
    assert.equal(response.headers.get("set-cookie"), null, label);
    assert.ok(elapsed >= 400, `${label} answered after ${elapsed} ms, before the 400 ms floor`);
    const headers = [...response.headers.entries()].filter(([k]) => k !== "date").sort();
    seen.push(JSON.stringify({ headers, body: await response.text() }));
  }
  assert.equal(new Set(seen).size, 1, "failure responses differ");
  assert.match(seen[0], /We couldn't sign you in/);
  // Reason classes stay server-side, and no event carries an email.
  const failures = events.filter((e) => e.event === "auth.login_failed").map((e) => e.fields.reason);
  for (const reason of ["UNKNOWN", "NO_CREDENTIAL", "INACTIVE", "LOCKED", "WRONG_PASSWORD"]) assert.ok(failures.includes(reason), reason);
  assert.equal(JSON.stringify(events).includes("@example.test"), false);
  assert.equal(JSON.stringify(events).includes(PASSWORD), false);
  // Unknown, credential-less and inactive attempts create no rows or counters.
  assert.equal(await db.staffCredential.count({ where: { staffId: noCredential.id } }), 0);
  assert.equal((await credential(inactive.id)).failedLoginCount, 0);
  assert.equal((await credential(locked.id)).failedLoginCount, 0);
  assert.equal((await credential(active.id)).failedLoginCount, 1);
});

test("timing distributions of the failure classes are comparable (S-02)", { skip }, async () => {
  const active = await createStaff();
  const noCredential = await createStaff({ password: null });
  const inactive = await createStaff({ active: false });
  const locked = await createStaff();
  await db.staffCredential.update({ where: { staffId: locked.id }, data: { lockedUntil: new Date(Date.now() + 15 * 60_000) } });
  const classes: Record<string, () => unknown> = {
    UNKNOWN: () => ({ email: email(), password: PASSWORD }),
    NO_CREDENTIAL: () => ({ email: noCredential.email, password: PASSWORD }),
    INACTIVE: () => ({ email: inactive.email, password: PASSWORD }),
    LOCKED: () => ({ email: locked.email, password: PASSWORD }),
    WRONG_PASSWORD: () => ({ email: active.email, password: "wrong " + PASSWORD }),
  };
  // One attempt of a class: its pre-floor work and its total time to answer.
  async function attempt(login: ReturnType<typeof serviceLogin>, name: string, body: () => unknown) {
    if (name === "WRONG_PASSWORD") await db.staffCredential.update({ where: { staffId: active.id }, data: { failedLoginCount: 0 } });
    let floorAt = 0;
    const started = performance.now();
    m.trace.setTraceRecorder((e) => { if (e === "floor:wait") floorAt = performance.now(); });
    const outcome = await login(body(), { ...ctx(), startedAt: started });
    m.trace.setTraceRecorder(null);
    assert.equal(outcome.ok, false);
    assert.equal(!outcome.ok && outcome.error.code, "UNAUTHENTICATED", name);
    return { work: floorAt - started, total: performance.now() - started };
  }
  // The mechanism under test is "every failure answers at the floor, whatever its class". The
  // floor must exceed the pre-floor work, which on this host depends on load (npm test runs
  // files in parallel, and other processes may be running), so the test calibrates it: three
  // times the slowest work of two unfloored warm-up rounds, and never under 1 s. The 400 ms
  // policy value is calibrated on the Railway instance class (P1-10). The assertions below are
  // unchanged: never before the floor, every median under it, and class medians within 100 ms.
  const unfloored = serviceLogin({ failureFloorMs: 0 });
  let slowest = 0;
  for (let round = 0; round < 2; round++) {
    for (const [name, body] of Object.entries(classes)) slowest = Math.max(slowest, (await attempt(unfloored, name, body)).work);
  }
  const FLOOR = Math.max(1000, Math.min(4000, Math.ceil(slowest * 3)));
  const login = serviceLogin({ failureFloorMs: FLOOR });
  const work: Record<string, number[]> = {};
  const total: Record<string, number[]> = {};
  for (let round = 0; round < 5; round++) {
    for (const [name, body] of Object.entries(classes)) {
      const sample = await attempt(login, name, body);
      (work[name] ??= []).push(sample.work);
      (total[name] ??= []).push(sample.total);
    }
  }
  // Calibration evidence for the handoff.
  const rounded = (r: Record<string, number[]>) => JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.map(Math.round)])));
  console.log(`[calibration] warm-up slowest ${Math.round(slowest)} ms, floor ${FLOOR} ms; pre-floor work ms by class: ${rounded(work)}; total ms: ${rounded(total)}`);
  // No failure ever answers before the floor.
  for (const t of Object.values(total).flat()) assert.ok(t >= FLOOR, `answered after ${t} ms, before the ${FLOOR} ms floor`);
  // Medians, because npm test runs files in parallel: a loaded host adds outliers of
  // ~150 ms of timer jitter to any class. A class-dependent difference would move its median.
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  for (const [name, xs] of Object.entries(work)) assert.ok(median(xs) < FLOOR, `${name} median work ${median(xs)} ms`);
  const totals = Object.values(total).map(median);
  assert.ok(Math.max(...totals) - Math.min(...totals) < 100, `median totals differ: ${rounded(total)}`);
});

test("login and reset interleave safely in both orders (S-01)", { skip }, async () => {
  // Reset commits between verification and activation: the activation refuses.
  const a = await createStaff();
  let pause!: () => void;
  const paused = new Promise<void>((r) => { pause = r; });
  let resume!: () => void;
  const resumed = new Promise<void>((r) => { resume = r; });
  const login = serviceLogin({ hooks: { afterVerify: async () => { pause(); await resumed; } } });
  const pending = login({ email: a.email, password: PASSWORD }, ctx());
  await paused;
  assert.ok((await m.credentials.setStaffPassword(db, { email: a.email }, "new " + PASSWORD)).ok);
  resume();
  const outcome = await pending;
  assert.equal(outcome.ok, false);
  assert.equal(await db.staffSession.count({ where: { staffId: a.id } }), 0);
  assert.ok(events.some((e) => e.event === "auth.login_failed" && e.fields.reason === "STALE_GENERATION" && e.fields.staffId === undefined));
  assert.equal((await credential(a.id)).generation, 2);
  assert.equal((await credential(a.id)).failedLoginCount, 1); // a stale activation counts as a failure

  // Activation commits first: the reset revokes that session and bumps the generation.
  const b = await createStaff();
  const ok = await serviceLogin()({ email: b.email, password: PASSWORD }, ctx());
  assert.ok(ok.ok);
  assert.ok(await resolve(ok.token));
  assert.ok((await m.credentials.setStaffPassword(db, { email: b.email }, "new " + PASSWORD)).ok);
  assert.equal(await resolve(ok.token), null);
  const row = await db.staffSession.findFirstOrThrow({ where: { staffId: b.id } });
  assert.equal(row.revokedReason, "PASSWORD_CHANGED");
  // The generation check alone also rejects it, even if the revoke had been missed.
  await db.staffSession.update({ where: { id: row.id }, data: { revokedAt: null, revokedReason: null } });
  assert.equal(await resolve(ok.token), null);
  // Old password no longer works; the new one does.
  assert.equal((await serviceLogin()({ email: b.email, password: PASSWORD }, ctx())).ok, false);
  assert.equal((await serviceLogin()({ email: b.email, password: "new " + PASSWORD }, ctx())).ok, true);
});

test("a rehash racing a reset never overwrites the reset hash", { skip }, async () => {
  const staff = await createStaff();
  const weak = await rawHash(Buffer.from(PASSWORD, "utf8"), { memoryCost: 4096, timeCost: 1, parallelism: 1 });
  await db.staffCredential.update({ where: { staffId: staff.id }, data: { passwordHash: weak } });
  // Without a race, a successful login upgrades the stored parameters and keeps the generation.
  const upgraded = await serviceLogin()({ email: staff.email, password: PASSWORD }, ctx());
  assert.ok(upgraded.ok);
  const after1 = await credential(staff.id);
  assert.match(after1.passwordHash, /m=19456,t=2,p=1/);
  assert.equal(after1.generation, 1);

  await db.staffCredential.update({ where: { staffId: staff.id }, data: { passwordHash: weak } });
  let pause!: () => void; const paused = new Promise<void>((r) => { pause = r; });
  let resume!: () => void; const resumed = new Promise<void>((r) => { resume = r; });
  const pending = serviceLogin({ hooks: { afterVerify: async () => { pause(); await resumed; } } })({ email: staff.email, password: PASSWORD }, ctx());
  await paused;
  assert.ok((await m.credentials.setStaffPassword(db, { email: staff.email }, "reset " + PASSWORD)).ok);
  const resetHash = (await credential(staff.id)).passwordHash;
  resume();
  assert.equal((await pending).ok, false);
  const after2 = await credential(staff.id);
  assert.equal(after2.passwordHash, resetHash);
  assert.equal(after2.generation, 2);
});

test("deactivation during login refuses the activation; reactivation does not restore sessions", { skip }, async () => {
  const staff = await createStaff();
  const first = await serviceLogin()({ email: staff.email, password: PASSWORD }, ctx());
  assert.ok(first.ok);
  let pause!: () => void; const paused = new Promise<void>((r) => { pause = r; });
  let resume!: () => void; const resumed = new Promise<void>((r) => { resume = r; });
  const pending = serviceLogin({ hooks: { afterVerify: async () => { pause(); await resumed; } } })({ email: staff.email, password: PASSWORD }, ctx());
  await paused;
  assert.ok((await m.credentials.deactivateStaff(db, staff.email)).ok);
  resume();
  assert.equal((await pending).ok, false);
  assert.equal(await resolve(first.token), null);
  assert.equal((await db.staffSession.findFirstOrThrow({ where: { staffId: staff.id } })).revokedReason, "DEACTIVATED");
  assert.ok((await m.credentials.reactivateStaff(db, staff.email)).ok);
  assert.equal(await resolve(first.token), null);
  assert.equal((await serviceLogin()({ email: staff.email, password: PASSWORD }, ctx())).ok, true);
});

test("five concurrent failures produce exactly one 15-minute lock", { skip }, async () => {
  const staff = await createStaff();
  const before = events.length;
  const login = serviceLogin();
  const outcomes = await Promise.all(Array.from({ length: 5 }, () => login({ email: staff.email, password: "wrong " + PASSWORD }, ctx())));
  assert.ok(outcomes.every((o) => !o.ok));
  const locked = await credential(staff.id);
  assert.ok(locked.lockedUntil);
  const minutes = (locked.lockedUntil!.getTime() - Date.now()) / 60_000;
  assert.ok(minutes > 14 && minutes <= 15, `locked for ${minutes} minutes`);
  assert.equal(locked.failedLoginCount, 0);
  assert.equal(events.slice(before).filter((e) => e.event === "auth.locked" && e.fields.staffId === staff.id).length, 1);

  // Failures while locked change nothing; a correct password is refused.
  await login({ email: staff.email, password: "wrong " + PASSWORD }, ctx());
  const correct = await login({ email: staff.email, password: PASSWORD }, ctx());
  assert.equal(correct.ok, false);
  const still = await credential(staff.id);
  assert.equal(still.lockedUntil!.getTime(), locked.lockedUntil!.getTime());
  assert.equal(still.failedLoginCount, 0);
  assert.equal(await db.staffSession.count({ where: { staffId: staff.id } }), 0);

  // The lock ends at lockedUntil <= db_now.
  await db.$executeRaw`UPDATE staff_credentials SET "lockedUntil" = statement_timestamp() - interval '1 millisecond' WHERE "staffId" = ${staff.id}`;
  assert.equal((await login({ email: staff.email, password: PASSWORD }, ctx())).ok, true);
  assert.equal((await credential(staff.id)).lockedUntil, null);
});

test("four failures do not lock; staff:credential unlock clears a lock", { skip }, async () => {
  const staff = await createStaff();
  const login = serviceLogin();
  for (let i = 0; i < 4; i++) await login({ email: staff.email, password: "wrong " + PASSWORD }, ctx());
  assert.equal((await credential(staff.id)).failedLoginCount, 4);
  assert.equal((await credential(staff.id)).lockedUntil, null);
  await login({ email: staff.email, password: "wrong " + PASSWORD }, ctx());
  assert.ok((await credential(staff.id)).lockedUntil);
  const generation = (await credential(staff.id)).generation;
  const io = fakeIo({});
  assert.equal(await m.cli.runStaffCredentialCli(["unlock", "--email", staff.email], io, db), 0);
  assert.equal((await credential(staff.id)).lockedUntil, null);
  assert.equal((await credential(staff.id)).generation, generation);
  assert.equal((await login({ email: staff.email, password: PASSWORD }, ctx())).ok, true);
});

test("per-client throttle: 10 a minute per trusted key, and a spoofed X-Forwarded-For does not escape it", { skip }, async () => {
  const limiter = m.rateLimit.createLoginLimiter({ perKeyPerMinute: 10, perKeyPerDay: 100, maxConcurrentPerKey: 1 });
  const login = serviceLogin({ limiter, failureFloorMs: 0 });
  const local = m.identity.clientIdentityConfig({}); // LOCAL_DEVELOPMENT: forwarding headers are ignored
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) {
    const headers = new Headers({ "x-forwarded-for": `203.0.113.${i + 1}` }); // a new spoofed address each time
    const outcome = await login({ email: email(), password: PASSWORD }, { ...ctx(), clientKey: m.identity.trustedClientKey(headers, local) });
    statuses.push(outcome.ok ? 200 : outcome.error.status);
  }
  assert.deepEqual(statuses, [...Array(10).fill(401), 429]);
  const refused = await login({ email: email(), password: PASSWORD }, { ...ctx(), clientKey: m.identity.LOCAL_CLIENT_KEY });
  assert.ok(!refused.ok && refused.error.retryAfterSeconds! > 0);
  assert.ok(events.some((e) => e.event === "auth.login_refused" && e.fields.status === 429));
});

// Codex F1 (PM ruling 2026-10-21): input is checked before the per-client limiter, so malformed
// attempts from any number of keys never take a place in its table or use up a client's count.
test("malformed sign-in input is refused before the per-client limiter and never fills its table", { skip }, async () => {
  const limiter = m.rateLimit.createLoginLimiter({ perKeyPerMinute: 10, perKeyPerDay: 100, maxConcurrentPerKey: 1 });
  const login = serviceLogin({ limiter, failureFloorMs: 0 });
  const malformed = [null, "x", { email: "not-an-email", password: PASSWORD }, { email: email() }, { email: email(), password: "" }];
  for (let i = 0; i < 50; i++) {
    const outcome = await login(malformed[i % malformed.length], { ...ctx(), clientKey: "malformed-" + (i % 2 ? i : 0) });
    assert.equal(!outcome.ok && outcome.error.status, 400);
  }
  assert.equal(limiter.size(), 0, "no malformed attempt took a place in the table");
  const staff = await createStaff();
  assert.equal((await login({ email: staff.email, password: PASSWORD }, { ...ctx(), clientKey: "malformed-0" })).ok, true, "and none used the client's count");
});

test("hashing overload returns 503 with Retry-After 10 and holds no database permit", { skip }, async () => {
  const hashSlots = m.semaphore.createSemaphore({ maxActive: 2, maxQueued: 10, maxWaitMs: 2000 });
  const held = [await hashSlots.acquire(), await hashSlots.acquire()];
  const queued = Array.from({ length: 10 }, () => hashSlots.acquire());
  const staff = await createStaff();
  const outcome = await serviceLogin({ hashSlots })({ email: staff.email, password: PASSWORD }, ctx());
  assert.equal(!outcome.ok && outcome.error.status, 503);
  assert.equal(!outcome.ok && outcome.error.retryAfterSeconds, 10);
  assert.deepEqual(m.admission.staffDbStats().STAFF_LOGIN_DB, { active: 0, queued: 0 });
  held.forEach((r) => r());
  for (const q of queued) (await q)();
  assert.equal((await credential(staff.id)).failedLoginCount, 0); // a refusal is not a failure
});

test("resource order: permits and hashing never overlap, all released before the floor (D-01)", { skip }, async () => {
  for (const [label, makeBody] of [["success", true], ["failure", false]] as const) {
    const staff = await createStaff();
    const log: string[] = [];
    m.trace.setTraceRecorder((e) => log.push(e));
    await serviceLogin()({ email: staff.email, password: makeBody ? PASSWORD : "wrong " + PASSWORD }, ctx());
    m.trace.setTraceRecorder(null);
    const expected = ["db:STAFF_LOGIN_DB:acquire", "db:STAFF_LOGIN_DB:release", "hash:acquire", "hash:release",
      "db:STAFF_LOGIN_DB:acquire", "db:STAFF_LOGIN_DB:release", ...(makeBody ? [] : ["floor:wait"])];
    assert.deepEqual(log, expected, label);
  }
  // Unknown accounts run the same database phase shape (a no-op failure phase).
  const log: string[] = [];
  m.trace.setTraceRecorder((e) => log.push(e));
  await serviceLogin()({ email: email(), password: PASSWORD }, ctx());
  m.trace.setTraceRecorder(null);
  assert.deepEqual(log, ["db:STAFF_LOGIN_DB:acquire", "db:STAFF_LOGIN_DB:release", "hash:acquire", "hash:release",
    "db:STAFF_LOGIN_DB:acquire", "db:STAFF_LOGIN_DB:release", "floor:wait"]);
  for (const stats of Object.values(m.admission.staffDbStats())) assert.deepEqual(stats, { active: 0, queued: 0 });
});

test("tampered, unknown, expired, idle, revoked and stale-generation cookies are rejected", { skip }, async () => {
  const staff = await createStaff();
  const fresh = async () => { const o = await serviceLogin()({ email: staff.email, password: PASSWORD }, ctx()); assert.ok(o.ok); return o.token; };
  // Malformed tokens never touch the database.
  const log: string[] = [];
  m.trace.setTraceRecorder((e) => log.push(e));
  const token = await fresh();
  log.length = 0;
  for (const bad of [token.slice(1), token + "x", token.replace(/.$/, "="), "", null]) assert.equal(await resolve(bad), null);
  assert.deepEqual(log, []);
  m.trace.setTraceRecorder(null);
  assert.equal(await resolve(m.session.generateSessionToken()), null); // unknown
  // Absolute expiry.
  const t1 = await fresh();
  await db.$executeRaw`UPDATE staff_sessions SET "expiresAt" = statement_timestamp(), "idleExpiresAt" = statement_timestamp() WHERE "tokenHash" = ${m.session.hashSessionToken(t1)}`;
  assert.equal(await resolve(t1), null);
  // Idle expiry, and the refresh cannot resurrect it.
  const t2 = await fresh();
  await db.$executeRaw`UPDATE staff_sessions SET "idleExpiresAt" = statement_timestamp() - interval '1 second', "lastSeenAt" = statement_timestamp() - interval '3 hours' WHERE "tokenHash" = ${m.session.hashSessionToken(t2)}`;
  assert.equal(await resolve(t2), null);
  const idle = await db.staffSession.findUniqueOrThrow({ where: { tokenHash: m.session.hashSessionToken(t2) } });
  assert.ok(idle.idleExpiresAt.getTime() < Date.now());
  // Revoked.
  const t3 = await fresh();
  await db.staffSession.update({ where: { tokenHash: m.session.hashSessionToken(t3) }, data: { revokedAt: new Date(), revokedReason: "ADMIN_REVOKED" } });
  assert.equal(await resolve(t3), null);
  // Stale generation.
  const t4 = await fresh();
  await db.staffCredential.update({ where: { staffId: staff.id }, data: { generation: { increment: 1 } } });
  assert.equal(await resolve(t4), null);
  assert.ok(events.some((e) => e.event === "auth.session_rejected" && e.fields.reason === "STALE_GENERATION"));
  assert.ok(events.some((e) => e.event === "auth.session_rejected" && e.fields.reason === "REVOKED"));
});

test("the idle refresh writes at most every 5 minutes and never extends the absolute expiry", { skip }, async () => {
  const staff = await createStaff();
  const o = await serviceLogin()({ email: staff.email, password: PASSWORD }, ctx());
  assert.ok(o.ok);
  const hash = m.session.hashSessionToken(o.token);
  const initial = await db.staffSession.findUniqueOrThrow({ where: { tokenHash: hash } });
  await resolve(o.token);
  assert.equal((await db.staffSession.findUniqueOrThrow({ where: { tokenHash: hash } })).lastSeenAt.getTime(), initial.lastSeenAt.getTime());
  await db.$executeRaw`UPDATE staff_sessions SET "lastSeenAt" = statement_timestamp() - interval '6 minutes', "idleExpiresAt" = statement_timestamp() + interval '10 minutes', "expiresAt" = statement_timestamp() + interval '1 hour' WHERE "tokenHash" = ${hash}`;
  const session = await resolve(o.token);
  const refreshed = await db.staffSession.findUniqueOrThrow({ where: { tokenHash: hash } });
  assert.ok(refreshed.lastSeenAt.getTime() > Date.now() - 5000);
  assert.equal(refreshed.idleExpiresAt.getTime(), refreshed.expiresAt.getTime()); // LEAST(now + 2 h, expiresAt)
  assert.equal(session?.expiresAt, refreshed.expiresAt.toISOString());
});

test("deactivated staff are rejected; a role change applies on the next request; DETAILER is not ADMIN", { skip }, async () => {
  const staff = await createStaff({ role: "DETAILER" });
  const o = await serviceLogin()({ email: staff.email, password: PASSWORD }, ctx());
  assert.ok(o.ok);
  const detailer = await resolve(o.token);
  assert.equal(detailer?.role, "STAFF");
  assert.throws(() => m.guards.assertAdmin(detailer!), (e: unknown) => e instanceof Error && (e as { code?: string }).code === "FORBIDDEN");
  await db.staff.update({ where: { id: staff.id }, data: { role: "ADMIN" } });
  const promoted = await resolve(o.token);
  assert.equal(promoted?.role, "ADMIN");
  assert.doesNotThrow(() => m.guards.assertAdmin(promoted!));
  await db.staff.update({ where: { id: staff.id }, data: { isActive: false } }); // even without the CLI's revoke
  assert.equal(await resolve(o.token), null);
});

test("login revokes the session carried by the request (fixation)", { skip }, async () => {
  const staff = await createStaff();
  const first = await m.loginRoute.POST(loginRequest({ email: staff.email, password: PASSWORD }));
  const old = cookieFrom(first)!;
  const second = await m.loginRoute.POST(loginRequest({ email: staff.email, password: PASSWORD }, { cookie: `${COOKIE}=${old}` }));
  assert.equal(second.status, 200);
  assert.notEqual(cookieFrom(second), old);
  assert.equal(await resolve(old), null);
  assert.equal((await db.staffSession.findUniqueOrThrow({ where: { tokenHash: m.session.hashSessionToken(old) } })).revokedReason, "ROTATED");
});

test("logout revokes, clears the cookie and is idempotent; unsafe methods check Origin first", { skip }, async () => {
  const staff = await createStaff();
  const token = cookieFrom(await m.loginRoute.POST(loginRequest({ email: staff.email, password: PASSWORD })))!;
  const logout = (headers: Record<string, string>) => m.logoutRoute.POST(new NextRequest("http://localhost:3000/api/admin/auth/logout", { method: "POST", headers }));
  for (const origin of [undefined, "null", "https://evil.example"]) {
    const response = await logout({ cookie: `${COOKIE}=${token}`, ...(origin ? { origin } : {}) });
    assert.equal(response.status, 403);
  }
  assert.ok(await resolve(token)); // the forbidden requests changed nothing
  const out = await logout({ origin: ORIGIN, cookie: `${COOKIE}=${token}` });
  assert.equal(out.status, 204);
  assert.match(out.headers.get("set-cookie")!, /Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  assert.equal(await resolve(token), null);
  assert.equal((await db.staffSession.findUniqueOrThrow({ where: { tokenHash: m.session.hashSessionToken(token) } })).revokedReason, "LOGOUT");
  assert.equal((await logout({ origin: ORIGIN, cookie: `${COOKIE}=${token}` })).status, 204);
  assert.equal((await logout({ origin: ORIGIN })).status, 204);
  // Login also checks Origin before any work.
  const unsafe: Record<string, string>[] = [{ origin: "" }, { origin: "null" }, { origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }, { "content-type": "text/plain" }];
  for (const headers of unsafe) {
    const response = await m.loginRoute.POST(loginRequest({ email: staff.email, password: PASSWORD }, headers));
    assert.equal(response.status, 403, JSON.stringify(headers));
    assert.equal(response.headers.get("set-cookie"), null);
  }
  assert.equal((await m.loginRoute.POST(loginRequest("x".repeat(17000)))).status, 403);
  assert.equal((await m.loginRoute.POST(loginRequest("{bad json"))).status, 400);
  assert.equal((await m.loginRoute.POST(loginRequest({ email: staff.email, password: PASSWORD, role: "ADMIN" }))).status, 400);
});

test("GET /api/admin/auth/session is 401 without a session and 503 when the database is down", { skip }, async () => {
  const response = await m.sessionRoute.GET(new NextRequest("http://localhost:3000/api/admin/auth/session"));
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.deepEqual(body, { ok: false, error: { code: "UNAUTHENTICATED", message: "Sign in to continue.", fieldErrors: {}, retryable: false, commitState: "NOT_APPLICABLE", currentBooking: null } });
  const down = new PrismaClient({ datasources: { db: { url: "postgresql://postgres@127.0.0.1:1/zeus_t007_down?connect_timeout=1" } } });
  await assert.rejects(m.session.resolveStaffSession(m.session.generateSessionToken(), "k", { db: down }),
    (e: unknown) => (e as { code?: string; status?: number }).code === "RETRYABLE_ERROR" && (e as { status: number }).status === 503);
  await down.$disconnect();
});

test("unknown-token lookups are limited to 30 a minute per client key, then refused without a query", { skip }, async () => {
  const key = `flood-${randomUUID()}`;
  for (let i = 0; i < 30; i++) assert.equal(await m.session.resolveStaffSession(m.session.generateSessionToken(), key), null);
  const log: string[] = [];
  m.trace.setTraceRecorder((e) => log.push(e));
  assert.equal(await m.session.resolveStaffSession(m.session.generateSessionToken(), key), null);
  m.trace.setTraceRecorder(null);
  assert.deepEqual(log, []);
  // The refusal never grants authority, and other keys are unaffected.
  const staff = await createStaff();
  const o = await serviceLogin()({ email: staff.email, password: PASSWORD }, ctx());
  assert.ok(o.ok);
  assert.equal(await m.session.resolveStaffSession(o.token, key), null);
  assert.ok(await m.session.resolveStaffSession(o.token, `other-${randomUUID()}`));
});

test("session admission: 2 active and 20 queued, then 503; permits return to zero", { skip }, async () => {
  const blockers = Array.from({ length: 22 }, () => m.admission.withStaffDb("STAFF_SESSION", (tx) => tx.$queryRaw`SELECT pg_sleep(0.3)`));
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(m.admission.staffDbStats().STAFF_SESSION, { active: 2, queued: 20 });
  await assert.rejects(m.session.resolveStaffSession(m.session.generateSessionToken(), "k"), (e: unknown) => (e as { status?: number }).status === 503);
  const settled = await Promise.allSettled(blockers);
  // Queued waits beyond the 1 s deadline are refused; nothing runs without its permit.
  assert.ok(settled.some((s) => s.status === "rejected"));
  assert.deepEqual(m.admission.staffDbStats().STAFF_SESSION, { active: 0, queued: 0 });
  assert.ok(events.some((e) => e.event === "staff.db_refused" && e.fields.scope === "STAFF_SESSION"));
});

test("statement timeouts are set per scope inside the permit's transaction", { skip }, async () => {
  const value = await m.admission.withStaffDb("STAFF_SESSION", (tx) => tx.$queryRaw<{ s: string; l: string }[]>`SELECT current_setting('statement_timeout') AS s, current_setting('lock_timeout') AS l`);
  assert.deepEqual(value[0], { s: "1s", l: "1s" }); // implicit refresh/revocation locks are bounded too
  // SET LOCAL semantics: the settings end with the transaction.
  assert.equal((await db.$queryRaw<{ s: string }[]>`SELECT current_setting('statement_timeout') AS s`)[0].s, "0");
  const lock = await m.admission.withStaffDb("STAFF_LOGIN_DB", (tx) => tx.$queryRaw<{ lock_timeout: string }[]>`SHOW lock_timeout`);
  assert.equal(lock[0].lock_timeout, "2s");
  await assert.rejects(m.admission.withStaffDb("STAFF_SESSION", (tx) => tx.$queryRaw`SELECT pg_sleep(1.5)`), (e: unknown) => (e as { status?: number }).status === 503);
  // The statement timeout is logged by code only (SQLSTATE 57014), never with the query.
  const refused = events.filter((e) => e.event === "staff.db_refused" && String(e.fields.reason).includes("57014"));
  assert.ok(refused.length >= 1, JSON.stringify(events.filter((e) => e.event === "staff.db_refused")));
  assert.equal(JSON.stringify(refused).includes("pg_sleep"), false);
});

test("duplicate case-insensitive emails fail closed as one INTEGRITY failure", { skip }, async () => {
  const address = email();
  const a = await createStaff();
  await db.staff.update({ where: { id: a.id }, data: { email: address.toUpperCase() } });
  await db.staff.create({ data: { name: "Dup", phone: "", email: address, role: "ADMIN" } });
  const before = events.length;
  const outcome = await serviceLogin()({ email: address, password: PASSWORD }, ctx());
  assert.equal(!outcome.ok && outcome.error.code, "UNAUTHENTICATED");
  assert.deepEqual(events.slice(before).filter((e) => e.event === "auth.login_failed").map((e) => e.fields.reason), ["INTEGRITY"]);
  assert.equal(await db.staffSession.count({ where: { staffId: a.id } }), 0);
});

// ---- Operator CLI: every set path screens, and the prompt round-trips to login (R-01) ----

function fakeIo(env: Record<string, string>, typed: string[] = []) {
  const stdin = new PassThrough() as PassThrough & { isTTY?: boolean; setRawMode?: (on: boolean) => void };
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  let out = "", err = "";
  const io = {
    stdin, env,
    stdout: { write: (s: string) => { out += s; return true; } },
    stderr: { write: (s: string) => { err += s; return true; } },
    get out() { return out; }, get err() { return err; },
  };
  // Type each answer after its prompt appears.
  let index = 0;
  const feed = () => { if (index < typed.length) { const answer = typed[index++]; setImmediate(() => stdin.write(answer + "\r")); } };
  io.stdout.write = (s: string) => { out += s; if (/password/i.test(s)) feed(); return true; };
  return io;
}

test("set-password via the prompt rejects CHARACTERS, LENGTH and BLOCKLIST and writes nothing", { skip }, async () => {
  for (const [pw, reason] of [["tab\tinside a long password", "CHARACTERS"], ["too short", "LENGTH"], ["Password12345678!", "BLOCKLIST"], ["zeusautodetailing", "BLOCKLIST"]] as const) {
    const address = email();
    const io = fakeIo({}, [pw, pw]);
    const code = await m.cli.runStaffCredentialCli(["set-password", "--email", address, "--name", "Prompt Test", "--role", "DETAILER"], io, db);
    assert.notEqual(code, 0, reason);
    assert.match(io.err, new RegExp(reason), reason);
    assert.equal(io.out.includes(pw) || io.err.includes(pw), false, "the password was echoed");
    assert.equal(await db.staff.count({ where: { email: address } }), 0, reason);
  }
  // Mismatched confirmation writes nothing either.
  const address = email();
  const io = fakeIo({}, [PASSWORD, PASSWORD + "!"]);
  assert.notEqual(await m.cli.runStaffCredentialCli(["set-password", "--email", address, "--name", "X Y", "--role", "ADMIN"], io, db), 0);
  assert.equal(await db.staff.count({ where: { email: address } }), 0);
});

test("R-01: a decomposed Jamo password set through the prompt signs in through the login form", { skip }, async () => {
  const address = email();
  // 100 distinct LVT syllables (each three Jamo when decomposed): 300 raw units, 100 code points.
  const syllables = Array.from({ length: 100 }, (_, i) => String.fromCodePoint(0xac00 + i * 84 + (i % 27) + 1)).join("");
  const decomposed = syllables.normalize("NFD");
  assert.equal(decomposed.length, 300);
  assert.equal(Array.from(syllables).length, 100);
  const io = fakeIo({}, [decomposed, decomposed]);
  assert.equal(await m.cli.runStaffCredentialCli(["set-password", "--email", address.toUpperCase(), "--name", "Jamo Tester", "--role", "DETAILER"], io, db), 0, io.err);
  const stored = await db.staff.findFirstOrThrow({ where: { email: address } }); // stored lowercase
  assert.equal(stored.role, "DETAILER");
  for (const form of [decomposed, decomposed.normalize("NFC")]) {
    const response = await m.loginRoute.POST(loginRequest({ email: address, password: form }));
    assert.equal(response.status, 200);
  }
  // STAFF_BOOTSTRAP_PASSWORD: read once, removed from the environment, never from argv.
  const env: Record<string, string> = { STAFF_BOOTSTRAP_PASSWORD: "mango river quartz ninety two" };
  const bootstrap = email();
  const io2 = fakeIo(env);
  assert.equal(await m.cli.runStaffCredentialCli(["set-password", "--email", bootstrap, "--name", "Env Boot", "--role", "ADMIN"], io2, db), 0, io2.err);
  assert.equal("STAFF_BOOTSTRAP_PASSWORD" in env, false);
  assert.equal((await m.loginRoute.POST(loginRequest({ email: bootstrap, password: "mango river quartz ninety two" }))).status, 200);
  assert.notEqual(await m.cli.runStaffCredentialCli(["set-password", "--email", bootstrap, "--password", "x"], fakeIo({}), db), 0);
});

test("competing bootstraps create one credential; deactivate and reactivate work through the CLI", { skip }, async () => {
  const address = email();
  const results = await Promise.all([1, 2].map(() => m.credentials.setStaffPassword(db, { email: address, name: "Race One", role: "ADMIN" }, PASSWORD)));
  assert.equal(results.filter((r) => r.ok).length >= 1, true);
  assert.equal(await db.staff.count({ where: { email: address } }), 1);
  const staff = await db.staff.findFirstOrThrow({ where: { email: address } });
  assert.equal(await db.staffCredential.count({ where: { staffId: staff.id } }), 1);
  assert.ok((await credential(staff.id)).generation <= 2);
  const token = await serviceLogin()({ email: address, password: PASSWORD }, ctx());
  assert.ok(token.ok);
  assert.equal(await m.cli.runStaffCredentialCli(["deactivate", "--email", address], fakeIo({}), db), 0);
  assert.equal(await resolve(token.token), null);
  assert.equal(await m.cli.runStaffCredentialCli(["reactivate", "--email", address], fakeIo({}), db), 0);
  assert.equal((await db.staff.findUniqueOrThrow({ where: { id: staff.id } })).isActive, true);
  assert.notEqual(await m.cli.runStaffCredentialCli(["unlock", "--email", email()], fakeIo({}), db), 0);
  assert.ok(events.some((e) => e.event === "auth.credential_changed" && e.fields.operation === "DEACTIVATE"));
});

// --- Review fixes (Codex review of eea7879) ---

test("F2: an aborted or queued session lookup dispatches no query, through the service and the HTTP route", { skip }, async () => {
  const staff = await createStaff();
  const o = await serviceLogin()({ email: staff.email, password: PASSWORD }, ctx());
  assert.ok(o.ok);
  const log: string[] = [];
  m.trace.setTraceRecorder((e) => log.push(e));
  try {
    await assert.rejects(m.session.resolveStaffSession(o.token, `k-${randomUUID()}`, { signal: AbortSignal.abort() }), is503);
    // The route passes request.signal through to the lookup.
    const aborted = new NextRequest("http://localhost:3000/api/admin/auth/session", { headers: { cookie: `${COOKIE}=${o.token}` }, signal: AbortSignal.abort() });
    assert.equal((await m.sessionRoute.GET(aborted)).status, 503);
    assert.deepEqual(log, []);
    // Queued behind both STAFF_SESSION permits, then aborted: it leaves the queue without a query.
    const blockers = [1, 2].map(() => m.admission.withStaffDb("STAFF_SESSION", (tx) => tx.$queryRaw`SELECT 1 AS slept FROM pg_sleep(0.4)`));
    await waitFor(() => m.admission.staffDbStats().STAFF_SESSION.active === 2, "two session permits");
    const controller = new AbortController();
    const queued = m.session.resolveStaffSession(o.token, `k-${randomUUID()}`, { signal: controller.signal });
    await waitFor(() => m.admission.staffDbStats().STAFF_SESSION.queued === 1, "a queued lookup");
    controller.abort();
    await assert.rejects(queued, is503);
    assert.deepEqual(m.admission.staffDbStats().STAFF_SESSION, { active: 2, queued: 0 });
    await Promise.all(blockers);
    assert.equal(log.filter((e) => e === "db:STAFF_SESSION:acquire").length, 2, log.join(" "));
  } finally { m.trace.setTraceRecorder(null); }
  assert.deepEqual(m.admission.staffDbStats().STAFF_SESSION, { active: 0, queued: 0 });
});

// LE decision 2026-10-18 (P1-06 delta review, replacing R17): an abort during an active read is
// bounded by the scope's statement timeout. The read keeps only its own permit until it has
// settled in the database, takes no second permit or connection, and nothing runs after it.
test("F2: an aborted active read holds only its own permit until it settles, bounded by the statement timeout", { skip }, async () => {
  const controller = new AbortController();
  const read = m.admission.withStaffDb("STAFF_SESSION", (tx) => tx.$queryRaw`SELECT 1 AS slept FROM pg_sleep(3)`, { signal: controller.signal, access: "read" });
  const outcome = read.then(() => "completed", (e) => (is503(e) ? "refused" : String(e)));
  await waitFor(async () => (await activeStatements("pg_sleep(3)")) === 1, "the read to start");
  const before = events.length;
  controller.abort();
  const abortedAt = performance.now();
  // While it runs: one SESSION permit, nothing else, and the next SESSION phase waits for it.
  const stats = m.admission.staffDbStats();
  assert.deepEqual(stats, { STAFF_LOGIN_DB: { active: 0, queued: 0 }, STAFF_SESSION: { active: 1, queued: 0 },
    STAFF_READ: { active: 0, queued: 0 }, STAFF_MUTATION: { active: 0, queued: 0 } });
  assert.equal(await outcome, "refused");
  const settledMs = performance.now() - abortedAt;
  // pg_sleep(3) is ended by the 1 s SESSION statement timeout, not by a second connection.
  assert.ok(settledMs < 2000, `aborted read held its permit ${Math.round(settledMs)} ms (statement timeout not applied)`);
  assert.equal(await activeStatements("pg_sleep(3)"), 0);
  assert.ok(events.slice(before).some((e) => e.event === "staff.db_refused" && e.fields.scope === "STAFF_SESSION" && e.fields.reason === "ABORTED"),
    JSON.stringify(events.slice(before)));
  for (const s of Object.values(m.admission.staffDbStats())) assert.deepEqual(s, { active: 0, queued: 0 });
  // A read that completes after the abort is still discarded: nothing that depends on it runs.
  const late = new AbortController();
  let after = false;
  const discarded = m.admission.withStaffPermit("STAFF_SESSION", async (permit) => {
    await permit.read(async (tx) => { const rows = await tx.$queryRaw`SELECT 1 AS slept FROM pg_sleep(0.2)`; return rows; });
    after = true;
  }, { signal: late.signal });
  await waitFor(async () => (await activeStatements("pg_sleep(0.2)")) === 1, "the short read to start");
  late.abort();
  await assert.rejects(discarded, is503);
  assert.equal(after, false);
});

test("F2 regression: anonymous aborts never take the READ or MUTATION reservation, even with every staff permit busy", { skip }, async () => {
  // Two anonymous-reachable SESSION reads and the LOGIN_DB phase run slow, then are aborted.
  const controllers = [new AbortController(), new AbortController(), new AbortController()];
  const anonymous = [
    m.admission.withStaffDb("STAFF_SESSION", (tx) => tx.$queryRaw`SELECT 1 AS slept FROM pg_sleep(0.8)`, { signal: controllers[0].signal, access: "read" }),
    m.admission.withStaffDb("STAFF_SESSION", (tx) => tx.$queryRaw`SELECT 1 AS slept FROM pg_sleep(0.8)`, { signal: controllers[1].signal, access: "read" }),
    m.admission.withStaffDb("STAFF_LOGIN_DB", (tx) => tx.$queryRaw`SELECT 1 AS slept FROM pg_sleep(0.8)`, { signal: controllers[2].signal, access: "read" }),
  ].map((p) => p.then(() => "completed", (e) => (is503(e) ? "refused" : String(e))));
  await waitFor(async () => (await activeStatements("pg_sleep(0.8)")) === 3, "three anonymous reads to start");
  controllers.forEach((c) => c.abort());
  // Authenticated READ and MUTATION work arrives while the aborted reads are still running.
  const started: string[] = [];
  const authenticated = [
    m.admission.withStaffDb("STAFF_READ", async (tx) => { started.push("READ"); return tx.$queryRaw`SELECT 1 AS slept FROM pg_sleep(0.3)`; }),
    m.admission.withStaffDb("STAFF_MUTATION", async (tx) => { started.push("MUTATION"); return tx.$queryRaw`SELECT 1 AS slept FROM pg_sleep(0.3)`; }),
  ];
  await waitFor(() => started.length === 2, "authenticated phases to start");
  // All five permits are busy; anonymous scopes hold three, the protected two hold their own work.
  assert.deepEqual(m.admission.staffDbStats(), { STAFF_LOGIN_DB: { active: 1, queued: 0 }, STAFF_SESSION: { active: 2, queued: 0 },
    STAFF_READ: { active: 1, queued: 0 }, STAFF_MUTATION: { active: 1, queued: 0 } });
  assert.equal(await activeStatements("pg_sleep(0.8)"), 3); // the aborted reads are still running, on their own permits
  await Promise.all(authenticated);
  assert.deepEqual(await Promise.all(anonymous), ["refused", "refused", "refused"]);
  for (const s of Object.values(m.admission.staffDbStats())) assert.deepEqual(s, { active: 0, queued: 0 });
  // No cancellation path exists that could reach another scope's permits.
  const source = await import("node:fs").then((fs) => fs.readFileSync(require.resolve("./db-admission"), "utf8"));
  assert.doesNotMatch(source, /pg_cancel_backend|tryAcquire/);
});

test("F2: an abort never cancels a started write; logout, refresh, activation and failure accounting commit holding their permit", { skip }, async () => {
  const staff = await createStaff();
  const sessionOf = async () => { const o = await serviceLogin()({ email: staff.email, password: PASSWORD }, ctx()); assert.ok(o.ok); return o.token; };
  // Abort a write while it waits on a row lock, check its permit is still held, then let it finish.
  async function abortWhileWaiting<T>(scope: "STAFF_SESSION" | "STAFF_LOGIN_DB", table: string, lock: Parameters<typeof holdLock>[0], start: (signal: AbortSignal) => Promise<T>) {
    const release = await holdLock(lock);
    const controller = new AbortController();
    const pending = start(controller.signal);
    await waitFor(async () => (await lockWaiters(table)) >= 1, `${scope} write to wait on the lock`);
    controller.abort();
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(m.admission.staffDbStats()[scope].active, 1, `${scope} permit released while its write was live`);
    await release();
    const result = await pending;
    assert.deepEqual(m.admission.staffDbStats()[scope], { active: 0, queued: 0 });
    return result;
  }

  // Logout.
  const t1 = await sessionOf();
  const h1 = m.session.hashSessionToken(t1);
  await abortWhileWaiting("STAFF_SESSION", "staff_sessions", (tx) => tx.$queryRaw`SELECT 1 FROM staff_sessions WHERE "tokenHash" = ${h1} FOR UPDATE`,
    (signal) => m.session.revokeStaffSession(t1, { signal }));
  assert.equal((await db.staffSession.findUniqueOrThrow({ where: { tokenHash: h1 } })).revokedReason, "LOGOUT");

  // Idle refresh.
  const t2 = await sessionOf();
  const h2 = m.session.hashSessionToken(t2);
  await db.$executeRaw`UPDATE staff_sessions SET "lastSeenAt" = statement_timestamp() - interval '6 minutes' WHERE "tokenHash" = ${h2}`;
  await abortWhileWaiting("STAFF_SESSION", "staff_sessions", (tx) => tx.$queryRaw`SELECT 1 FROM staff_sessions WHERE "tokenHash" = ${h2} FOR UPDATE`,
    (signal) => m.session.resolveStaffSession(t2, `k-${randomUUID()}`, { signal }).catch(() => null));
  const refreshed = await db.staffSession.findUniqueOrThrow({ where: { tokenHash: h2 } });
  assert.ok(Date.now() - refreshed.lastSeenAt.getTime() < 5000, "the started refresh did not commit");

  // Activation: the session is created even though the client went away.
  const sessionsBefore = await db.staffSession.count({ where: { staffId: staff.id } });
  const activated = await abortWhileWaiting("STAFF_LOGIN_DB", "staff_credentials", (tx) => tx.$queryRaw`SELECT 1 FROM staff_credentials WHERE "staffId" = ${staff.id} FOR UPDATE`,
    (signal) => serviceLogin()({ email: staff.email, password: PASSWORD }, { ...ctx(), signal }));
  assert.equal(activated.ok, true);
  assert.equal(await db.staffSession.count({ where: { staffId: staff.id } }), sessionsBefore + 1);

  // Failure accounting.
  const failed = await abortWhileWaiting("STAFF_LOGIN_DB", "staff_credentials", (tx) => tx.$queryRaw`SELECT 1 FROM staff_credentials WHERE "staffId" = ${staff.id} FOR UPDATE`,
    (signal) => serviceLogin({ failureFloorMs: 0 })({ email: staff.email, password: "wrong " + PASSWORD }, { ...ctx(), signal }));
  assert.equal(failed.ok, false);
  assert.equal((await credential(staff.id)).failedLoginCount, 1);
});

test("a client abort after verification still counts the failure (no lockout bypass by disconnecting)", { skip }, async () => {
  const staff = await createStaff();
  for (let i = 0; i < 5; i++) {
    const controller = new AbortController();
    const login = serviceLogin({ failureFloorMs: 0, hooks: { afterVerify: async () => { controller.abort(); } } });
    assert.equal((await login({ email: staff.email, password: "wrong " + PASSWORD }, { ...ctx(), signal: controller.signal })).ok, false);
  }
  assert.ok((await credential(staff.id)).lockedUntil, "five aborted wrong passwords must lock the account");
  assert.equal((await serviceLogin()({ email: staff.email, password: PASSWORD }, ctx())).ok, false);
});

// Pauses each session lookup after its read and counts the rows its refresh UPDATE writes.
function instrumentedDb(afterSessionRead: () => Promise<void>, written: { rows: number }): PrismaClient {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== "$transaction") return Reflect.get(target, prop, receiver);
      return (fn: (tx: unknown) => Promise<unknown>, options: unknown) => target.$transaction((tx) => fn(new Proxy(tx, {
        get(t, p, r) {
          if (p !== "$queryRaw") return Reflect.get(t, p, r);
          return async (strings: TemplateStringsArray, ...values: unknown[]) => {
            const result = await t.$queryRaw(strings, ...values);
            const sql = strings.join("?").trim();
            if (sql.startsWith('SELECT s."id"')) await afterSessionRead();
            if (sql.startsWith('UPDATE "staff_sessions" SET "lastSeenAt"')) written.rows += (result as unknown[]).length;
            return result;
          };
        },
      })), options as never);
    },
  }) as PrismaClient;
}

test("F4: concurrent due lookups write one refresh and both succeed", { skip }, async () => {
  const staff = await createStaff();
  const o = await serviceLogin()({ email: staff.email, password: PASSWORD }, ctx());
  assert.ok(o.ok);
  const hash = m.session.hashSessionToken(o.token);
  await db.$executeRaw`UPDATE staff_sessions SET "lastSeenAt" = statement_timestamp() - interval '6 minutes', "idleExpiresAt" = statement_timestamp() + interval '10 minutes' WHERE "tokenHash" = ${hash}`;
  let arrived = 0;
  let open!: () => void; const gate = new Promise<void>((r) => { open = r; });
  const written = { rows: 0 };
  const instrumented = instrumentedDb(async () => { arrived++; await gate; }, written);
  // Both lookups read the same due row before either refreshes it.
  const lookups = [1, 2].map(() => m.session.resolveStaffSession(o.token, `k-${randomUUID()}`, { db: instrumented }));
  await waitFor(() => arrived === 2, "both lookups to read the due row");
  open();
  const [a, b] = await Promise.all(lookups);
  assert.ok(a && b, "a lookup that lost the refresh race was rejected");
  assert.equal(written.rows, 1, "the five-minute write throttle was bypassed");
  assert.equal(a.idleExpiresAt, b.idleExpiresAt);
  const row = await db.staffSession.findUniqueOrThrow({ where: { tokenHash: hash } });
  assert.equal(row.idleExpiresAt.toISOString(), a.idleExpiresAt);
  assert.ok(row.idleExpiresAt <= row.expiresAt);
  // Revocation and expiry still apply to a due lookup.
  await db.$executeRaw`UPDATE staff_sessions SET "lastSeenAt" = statement_timestamp() - interval '6 minutes' WHERE "tokenHash" = ${hash}`;
  await db.staffSession.update({ where: { tokenHash: hash }, data: { revokedAt: new Date(), revokedReason: "ADMIN_REVOKED" } });
  assert.equal(await resolve(o.token), null);
});

test("F5: failure accounting re-reads Staff under the credential lock; nothing is counted while inactive", { skip }, async () => {
  const staff = await createStaff();
  let paused = 0;
  let resume!: () => void; const resumed = new Promise<void>((r) => { resume = r; });
  const login = serviceLogin({ failureFloorMs: 0, hooks: { afterVerify: async () => { paused++; await resumed; } } });
  // Six outstanding attempts, enough to lock: five wrong passwords and one correct one.
  const attempts = [
    ...Array.from({ length: 5 }, () => login({ email: staff.email, password: "wrong " + PASSWORD }, ctx())),
    login({ email: staff.email, password: PASSWORD }, ctx()),
  ];
  await waitFor(() => paused === 6, "six verified attempts");
  assert.ok((await m.credentials.deactivateStaff(db, staff.email)).ok);
  resume();
  assert.ok((await Promise.all(attempts)).every((o) => !o.ok));
  const after = await credential(staff.id);
  assert.equal(after.failedLoginCount, 0);
  assert.equal(after.lockedUntil, null);
  assert.equal(await db.staffSession.count({ where: { staffId: staff.id } }), 0);
  // Reactivated staff are not left locked by attempts made while inactive.
  assert.ok((await m.credentials.reactivateStaff(db, staff.email)).ok);
  assert.equal((await serviceLogin()({ email: staff.email, password: PASSWORD }, ctx())).ok, true);
});
