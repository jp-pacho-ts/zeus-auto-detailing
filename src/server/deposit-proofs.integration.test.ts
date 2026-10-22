import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { createAndMigrate, mapPublisher, provisionRuntimeRole, publish, runtimeRoleUrl, siblingDatabaseUrl } from "./catalog-db.fixture";
import { bySlug, readManifest, releaseFromManifest, sizeId } from "./catalog.fixture";
import { getBookingQuote } from "./catalog-quote";
import { createDayBooking } from "./bookings-create";
import { parseBookingConfiguration, signManagementToken } from "./bookings-credentials";
import * as management from "./bookings-management";
import { managementHttp } from "./bookings-management-http";
import * as admin from "./admin";
import { proofImageResponse } from "./admin/deposit";
import { depositProofHttp, uploadDepositProof, MAX_PROOFS_PER_BOOKING } from "./deposit-proofs";
import { drainDepositNotices } from "./notifications/bookings";
import { smtpSimulation } from "./notifications/smtp.fixture";
import { animatedWebp, chunk, jpeg, png, seg, wchunk, webpExtended, withAnimationFlag, withApp0Thumbnails } from "./deposit-image.fixture";

// P1-18 security cases, test-first. Every service call runs as the provisioned zeus_app role on
// an isolated sibling database; fixtures use the owner. Synthetic images and customers only.
const url = process.env.T007_TEST_DATABASE_URL, skip = !url;
const siblingUrl = url ? siblingDatabaseUrl(url, "deposit") : "postgresql://unused@localhost/zeus_t007_unused";
const root = new PrismaClient({ datasources: { db: { url: url ?? "postgresql://unused@localhost/zeus_t007_unused" } } });
const owner = new PrismaClient({ datasources: { db: { url: siblingUrl } } });
let db: PrismaClient = owner;
const c = parseBookingConfiguration({
  BOOKING_QUOTE_KEYS: "q:" + randomBytes(32).toString("base64url"), BOOKING_QUOTE_ACTIVE_KID: "q",
  MANAGEMENT_GRANT_KEYS: "g:" + randomBytes(32).toString("base64url"), MANAGEMENT_GRANT_ACTIVE_KID: "g",
  MANAGEMENT_SESSION_KEYS: "s:" + randomBytes(32).toString("base64url"), MANAGEMENT_SESSION_ACTIVE_KID: "s",
  ONLINE_BOOKING_MODE: "OPEN", TURNSTILE_SECRET_KEY: "synthetic_secret_for_local_deposit_checks",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "synthetic_site_key_for_deposit_checks", TURNSTILE_ALLOWED_HOSTNAMES: "localhost",
  APP_ORIGIN: "http://localhost:3000", CLIENT_IP_SOURCE: "PROXY_HOPS", TRUSTED_PROXY_HOPS: "1", NODE_ENV: "test",
});
const manifest = readManifest(), release = releaseFromManifest();
let server: Server, endpoint = "", seq = 0, adminId = "", staffId = "";
const day = (n = 4) => new Date(Date.now() + 8 * 3600000 + n * 86400000).toISOString().slice(0, 10);
const headers = (token?: string, extra: Record<string, string> = {}) => new Headers({
  origin: c.origin, "x-zeus-booking": "1", "content-type": "application/json",
  "x-forwarded-for": "198.51." + Math.floor(++seq / 250) + "." + ((seq % 250) + 1),
  ...(token ? { cookie: "booking-management=" + token } : {}), ...extra,
});
const options = (token?: string) => ({ db, config: c, headers: headers(token) });
const ADMIN = () => ({ staffId: adminId, role: "ADMIN" as const, sessionId: randomUUID() });
const STAFF = () => ({ staffId, role: "STAFF" as const, sessionId: randomUUID() });
type Outcome<T> = { result: { ok: true; data: T } | { ok: false; error: { code: string; message: string; commitState: string; fieldErrors: Record<string, string[]>; retryAfterSeconds: number | null } } };
function success<T>(r: Outcome<T>): T {
  assert.ok(r.result.ok, JSON.stringify(r.result));
  return r.result.ok ? r.result.data : (undefined as never);
}
const code = (r: Outcome<unknown>) => (r.result.ok ? "OK" : r.result.error.code);
const b64 = (b: Buffer) => b.toString("base64");
const upload = (token: string | undefined, body: unknown, opts: Partial<ReturnType<typeof options>> = {}) =>
  uploadDepositProof(async () => body, { ...options(token), ...opts });
const proofBody = (bookingId: string, image: Buffer, key = randomUUID()) => ({ bookingId, idempotencyKey: key, image: b64(image) });
const proofCount = (bookingId: string) => owner.bookingDepositProof.count({ where: { bookingId } });

before(async () => {
  if (skip) return;
  assert.equal(process.env.DATABASE_URL, url);
  await createAndMigrate(root, siblingUrl);
  const tooling = await import(path.join(process.cwd(), "prisma/catalog/catalog.mjs"));
  adminId = await mapPublisher(owner, "p118-admin@example.test");
  staffId = (await owner.staff.create({ data: { name: "P118 Detailer", phone: "", email: "p118-detailer@example.test", role: "DETAILER" } })).id;
  await publish(owner, manifest, tooling.stableId);
  await owner.scheduleConfig.create({ data: { effectiveDate: new Date("2000-01-01") } });
  await owner.timeSlot.createMany({ data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startTime: "08:00", endTime: "18:00", maxVehicleCapacity: 2 })) });
  provisionRuntimeRole(siblingUrl);
  db = new PrismaClient({ datasources: { db: { url: runtimeRoleUrl(siblingUrl) } } });
  server = createServer((req, res) => {
    req.resume();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ success: true, action: "booking_create", hostname: "localhost" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = "http://127.0.0.1:" + (server.address() as { port: number }).port;
});
after(async () => {
  if (db !== owner) await db.$disconnect();
  await owner.$disconnect();
  await root.$disconnect();
  if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
async function fresh(offset = 4) {
  const selection = { vehicleCategoryId: sizeId(release, "S"), lines: [{ serviceId: bySlug(release, "basic-wash").id, quantity: 1 }] };
  const q = await getBookingQuote(selection, { db, ring: c.quote });
  if (!q.ok) throw Error("quote");
  const n = ++seq;
  const commit = await createDayBooking({
    contractVersion: 4 as const, idempotencyKey: randomUUID(), vehicleCategoryId: selection.vehicleCategoryId,
    lines: q.data.quote.lines.map((l) => ({ serviceId: l.serviceId, quantity: l.quantity })), bookingDate: day(offset),
    acceptedQuote: q.data.quote, turnstileToken: randomUUID(), customerName: "P118 PRIVATE NAME",
    customerPhone: "+63918" + String(n).padStart(7, "0"), customerEmail: "p118-private@example.test",
    vehicleModel: "P118 PRIVATE MODEL", vehiclePlate: "P118 PLATE", specialRequests: "P118 PRIVATE NOTES",
  }, { ...options(), turnstileEndpoint: endpoint });
  const data = success(commit);
  return { id: data.booking.id, ref: data.booking.referenceCode, token: commit.session!.token };
}
const revision = async (id: string) => (await owner.booking.findUniqueOrThrow({ where: { id } })).revision;

test("a customer sends PNG, JPEG and WebP proofs through the management session; type comes from content and metadata is stripped", { skip }, async () => {
  const a = await fresh();
  const before = await revision(a.id);
  const canary = "P118-EXIF-GPS-CANARY";
  const r = success(await upload(a.token, proofBody(a.id, png(4, 3, [chunk("tEXt", Buffer.from("Comment\0" + canary))]))));
  assert.equal(r.replayed, false);
  assert.deepEqual(r.booking.deposit, { status: "PROOF_SENT", proofsSent: 1, proofsAllowed: 3, message: null });
  assert.equal(r.booking.revision, before + 1);
  success(await upload(a.token, proofBody(a.id, jpeg(6, 5, [seg(0xe1, Buffer.from("Exif\0\0" + canary))]))));
  success(await upload(a.token, proofBody(a.id, webpExtended([wchunk("EXIF", Buffer.from(canary))]))));
  const rows = await owner.bookingDepositProof.findMany({ where: { bookingId: a.id }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(rows.map((p) => [p.contentType, p.width, p.height]), [["image/png", 4, 3], ["image/jpeg", 6, 5], ["image/webp", 2, 2]]);
  for (const p of rows) {
    assert.equal(Buffer.from(p.data).includes(canary), false, "metadata stored");
    assert.equal(p.byteSize, p.data.length);
    assert.match(p.keyHash, /^[a-f0-9]{64}$/);
  }
  // Staff read returns exactly the stored (sanitized) bytes with the stored content type.
  const proof = await admin.readDepositProof(STAFF(), a.id, rows[0].id, { db });
  assert.equal(proof.contentType, "image/png");
  assert.ok(Buffer.from(proof.data).equals(Buffer.from(rows[0].data)));
  // The customer view shows the status only; staff see the list without the bytes.
  const view = success(await management.readManagedBooking(options(a.token)));
  assert.deepEqual(view.deposit, { status: "PROOF_SENT", proofsSent: 3, proofsAllowed: 3, message: null });
  const detail = await admin.getBookingDetail(STAFF(), a.id, { db });
  assert.equal(detail.depositStatus, "PROOF_SENT");
  assert.deepEqual(detail.depositProofs.map((p) => Object.keys(p).sort().join()), Array(3).fill("byteSize,contentType,createdAt,height,id,width"));
  assert.equal(JSON.stringify(detail).includes(b64(Buffer.from(rows[0].data)).slice(0, 40)), false, "detail carries no image bytes");
  assert.deepEqual(detail.history.filter((h) => h.source === "CUSTOMER").map((h) => [h.action, h.actorStaffId, h.reason]), Array(3).fill(["DEPOSIT_PROOF_SENT", null, null]));
});

// Review F1: a real, decodable JPEG whose APP0 thumbnails (JFIF and JFXX) carry the canary.
test("JPEG APP0 thumbnails are gone from storage and from the staff copy, which still decodes to the same pixels", { skip }, async () => {
  const a = await fresh();
  const canary = "P118-JFXX-THUMBNAIL-CANARY";
  const input = withApp0Thumbnails(await sharp({ create: { width: 5, height: 4, channels: 3, background: { r: 200, g: 60, b: 20 } } }).jpeg().toBuffer(), canary);
  const pixels = await sharp(input).raw().toBuffer();
  success(await upload(a.token, proofBody(a.id, input)));
  const row = await owner.bookingDepositProof.findFirstOrThrow({ where: { bookingId: a.id } });
  assert.deepEqual([row.contentType, row.width, row.height], ["image/jpeg", 5, 4]);
  assert.equal(Buffer.from(row.data).includes(canary), false, "thumbnail stored");
  const served = Buffer.from(await proofImageResponse(await admin.readDepositProof(STAFF(), a.id, row.id, { db })).arrayBuffer());
  assert.equal(served.includes(canary), false, "thumbnail served to staff");
  assert.ok((await sharp(served).raw().toBuffer()).equals(pixels), "the staff copy decodes to the same pixels");
});

// P1-12 F1 (Codex review): a real two-frame WebP whose ANMF frames carry a canary is refused; no
// file, status, revision or staff-visible copy results, through the service or the HTTP route.
test("animated WebP proofs are refused with nothing stored or served", { skip }, async () => {
  const a = await fresh();
  const canary = "P112-ANMF-FRAME-CANARY";
  const animated = await animatedWebp(canary);
  const before = await revision(a.id);
  for (const image of [animated, withAnimationFlag(animated, false)]) {
    const r = await upload(a.token, proofBody(a.id, image));
    assert.equal(code(r), "UNSUPPORTED_FILE");
    assert.equal(!r.result.ok && r.result.error.commitState, "NOT_APPLICABLE");
  }
  const http = await depositProofHttp(new NextRequest("http://localhost:3000/api/bookings/manage/deposit-proofs", {
    method: "POST", headers: headers(a.token), body: JSON.stringify(proofBody(a.id, animated)),
  }), { db, config: c });
  assert.equal(http.status, 400);
  assert.equal((await http.clone().json()).error.code, "UNSUPPORTED_FILE");
  assert.equal((await http.text()).includes(canary), false);
  assert.equal(await proofCount(a.id), 0);
  assert.equal((await owner.bookingDepositProof.count({ where: { data: { equals: animated } } })), 0);
  const booking = await owner.booking.findUniqueOrThrow({ where: { id: a.id } });
  assert.deepEqual([booking.depositStatus, booking.revision], ["NONE", before]);
  const detail = await admin.getBookingDetail(STAFF(), a.id, { db });
  assert.deepEqual(detail.depositProofs, []);
  assert.equal(JSON.stringify(detail).includes(canary), false);
  assert.deepEqual(success(await management.readManagedBooking(options(a.token))).deposit, { status: "NONE", proofsSent: 0, proofsAllowed: 3, message: null });
});

test("wrong and disguised types are refused with nothing stored (HTML, SVG, script, GIF, PDF, signature + markup)", { skip }, async () => {
  const a = await fresh();
  for (const bad of [
    Buffer.from("<!doctype html><script>alert(1)</script>"), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),
    Buffer.from("alert(document.cookie)"), Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "latin1"), Buffer.from("%PDF-1.7\n"),
    Buffer.concat([png().subarray(0, 8), Buffer.from("<html><script>alert(1)</script>")]),
  ]) {
    const r = await upload(a.token, proofBody(a.id, bad));
    assert.equal(code(r), "UNSUPPORTED_FILE");
    assert.ok(!r.result.ok && r.result.error.fieldErrors.image?.length);
    assert.equal(!r.result.ok && r.result.error.commitState, "NOT_APPLICABLE");
  }
  // A second booking: the per-booking limit (6 a minute) counts refused attempts too.
  const b = await fresh();
  for (const body of [{ bookingId: b.id, idempotencyKey: randomUUID(), image: "not base64 !!" }, { bookingId: b.id, idempotencyKey: randomUUID(), image: b64(png()), fileName: "x.png" },
    { bookingId: b.id, idempotencyKey: "not-a-key", image: b64(png()) }, { bookingId: b.id, idempotencyKey: randomUUID(), image: "" }])
    assert.equal(code(await upload(b.token, body)), "VALIDATION_ERROR");
  assert.equal(code(await upload(a.token, proofBody(a.id, png()))), "RATE_LIMITED", "seventh attempt on one booking within a minute");
  assert.equal(await proofCount(a.id) + (await proofCount(b.id)), 0);
  assert.equal((await owner.booking.findUniqueOrThrow({ where: { id: a.id } })).depositStatus, "NONE");
});

test("oversize: more than 5 MB is refused (service 413, and the HTTP route stops reading a large body)", { skip }, async () => {
  const a = await fresh();
  const big = Buffer.concat([png(), Buffer.alloc(5 * 1024 * 1024)]);
  const r = await upload(a.token, proofBody(a.id, big));
  assert.equal(code(r), "FILE_TOO_LARGE");
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulled += 1; controller.enqueue(new Uint8Array(1024 * 1024).fill(0x41)); if (pulled > 64) controller.close(); } });
  const res = await depositProofHttp(new Request(c.origin + "/api/bookings/manage/deposit-proofs", { method: "POST", headers: headers(a.token), body: stream, duplex: "half" } as RequestInit), { db, config: c });
  assert.equal(res.status, 413);
  assert.ok(pulled <= 10, "read " + pulled + " MiB");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(await proofCount(a.id), 0);
});

test("at most 3 files per booking; a fourth is refused 409; the database guard holds under concurrent inserts", { skip }, async () => {
  const a = await fresh();
  for (let i = 0; i < MAX_PROOFS_PER_BOOKING; i++) success(await upload(a.token, proofBody(a.id, png(2, 2, [], undefined, i))));
  const r = await upload(a.token, proofBody(a.id, png(2, 2, [], undefined, 99)));
  assert.equal(code(r), "DEPOSIT_PROOF_LIMIT");
  assert.equal(!r.result.ok && r.result.error.commitState, "NOT_COMMITTED");
  assert.equal(await proofCount(a.id), 3);
  // Two writers racing for the third slot directly in SQL: exactly one wins.
  const b = await fresh();
  for (let i = 0; i < 2; i++) success(await upload(b.token, proofBody(b.id, png(2, 2, [], undefined, i))));
  const insert = (n: number) => owner.$executeRawUnsafe(`INSERT INTO booking_deposit_proofs (id,"bookingId","keyHash","contentHash","clientHash","contentType","byteSize",width,height,data) VALUES ($1,$2,$3,$3,$3,'image/png',1,1,1,'\\x00')`,
    randomUUID(), b.id, String(n).repeat(64).slice(0, 64));
  const raced = await Promise.allSettled([insert(1), insert(2)]);
  assert.equal(raced.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(await proofCount(b.id), 3);
});

test("no session, tampered, expired or revoked sessions and another customer's booking are refused 401 before the body is read", { skip }, async () => {
  const a = await fresh(), b = await fresh();
  const image = png();
  assert.equal(code(await upload(undefined, proofBody(a.id, image))), "UNAUTHENTICATED");
  assert.equal(code(await upload(a.token + "x", proofBody(a.id, image))), "UNAUTHENTICATED");
  const past = new Date(Date.now() - 2 * 3600000).toISOString(), ended = new Date(Date.now() - 3600000).toISOString();
  const expired = signManagementToken("BOOKING_MANAGEMENT_SESSION", { bookingId: a.id, credentialVersion: 1, issuedAt: past, expiresAt: ended, grantKid: "g" }, c.session);
  assert.equal(code(await upload(expired, proofBody(a.id, image))), "UNAUTHENTICATED");
  assert.equal(code(await upload(a.token, proofBody(b.id, image))), "UNAUTHENTICATED", "another customer's booking");
  let read = false;
  const r = await uploadDepositProof(async () => { read = true; return proofBody(a.id, image); }, options());
  assert.equal(code(r), "UNAUTHENTICATED");
  assert.equal(read, false, "body read without a session");
  // A revoked credential version (the shop re-issued access) refuses the old session.
  await owner.$executeRawUnsafe(`UPDATE bookings SET "managementTokenVersion"="managementTokenVersion"+1 WHERE id=$1`, a.id);
  assert.equal(code(await upload(a.token, proofBody(a.id, image))), "UNAUTHENTICATED");
  assert.equal(await proofCount(a.id) + (await proofCount(b.id)), 0);
});

test("same-origin and CSRF checks: wrong origin, cross-site or missing booking header are refused 403", { skip }, async () => {
  const a = await fresh();
  const tampered: Record<string, string>[] = [{ origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }, { "x-zeus-booking": "0" }];
  for (const extra of tampered) {
    const r = await uploadDepositProof(async () => proofBody(a.id, png()), { db, config: c, headers: headers(a.token, extra) });
    assert.equal(code(r), "FORBIDDEN");
  }
  const http = await depositProofHttp(new Request(c.origin + "/api/bookings/manage/deposit-proofs?x=1", { method: "POST", headers: headers(a.token), body: JSON.stringify(proofBody(a.id, png())) }), { db, config: c });
  assert.equal(http.status, 400, "URL parameters refused");
  const wrongType = await depositProofHttp(new Request(c.origin + "/api/bookings/manage/deposit-proofs", { method: "POST", headers: headers(a.token, { "content-type": "image/png" }), body: new Uint8Array(png()) }), { db, config: c });
  assert.equal(wrongType.status, 400);
  assert.equal(await proofCount(a.id), 0);
});

test("replay: the same key and image replay without a second file; the same key with another image or booking conflicts", { skip }, async () => {
  const a = await fresh(), b = await fresh();
  const body = proofBody(a.id, png());
  const first = success(await upload(a.token, body));
  const again = success(await upload(a.token, body));
  assert.equal(again.replayed, true);
  assert.equal(again.booking.revision, first.booking.revision);
  assert.equal(code(await upload(a.token, { ...body, image: b64(png(3, 3)) })), "IDEMPOTENCY_CONFLICT");
  assert.equal(code(await upload(b.token, { ...body, bookingId: b.id })), "IDEMPOTENCY_CONFLICT");
  assert.equal(await proofCount(a.id), 1);
  assert.equal(await proofCount(b.id), 0);
});

test("cancelled bookings take no new proof; cancel and reschedule keep the deposit status and files", { skip }, async () => {
  const a = await fresh();
  success(await upload(a.token, proofBody(a.id, png())));
  let view = success(await management.readManagedBooking(options(a.token)));
  const moved = success(await management.rescheduleManagedBooking({ bookingId: a.id, idempotencyKey: randomUUID(), expectedRevision: view.revision, bookingDate: day(6) }, options(a.token)));
  assert.equal(moved.booking.deposit.status, "PROOF_SENT");
  const cancelled = success(await management.cancelManagedBooking({ bookingId: a.id, idempotencyKey: randomUUID(), expectedRevision: moved.booking.revision }, options(a.token)));
  assert.equal(cancelled.booking.deposit.status, "PROOF_SENT");
  const r = await upload(a.token, proofBody(a.id, png(3, 3)));
  assert.equal(code(r), "BOOKING_NOT_MANAGEABLE");
  view = success(await management.readManagedBooking(options(a.token)));
  assert.deepEqual([view.status, view.deposit.status, view.deposit.proofsSent], ["CANCELLED", "PROOF_SENT", 1]);
  assert.equal(await proofCount(a.id), 1);
});

test("ADMIN alone marks RECEIVED or REJECTED with the revision and one audit row; STAFF is refused; customers see only fixed wording", { skip }, async () => {
  const a = await fresh();
  success(await upload(a.token, proofBody(a.id, png())));
  const rev = await revision(a.id);
  await assert.rejects(admin.setDepositStatus(STAFF(), a.id, { expectedRevision: rev, status: "RECEIVED" }, { db }), (e: { code?: string }) => e.code === "FORBIDDEN");
  await assert.rejects(admin.setDepositStatus(ADMIN(), a.id, { expectedRevision: rev - 1, status: "RECEIVED" }, { db }), (e: { code?: string; currentBooking?: { revision: number } }) => e.code === "VERSION_CONFLICT" && e.currentBooking?.revision === rev);
  await assert.rejects(admin.setDepositStatus(ADMIN(), a.id, { expectedRevision: rev, status: "PROOF_SENT" }, { db }), (e: { code?: string }) => e.code === "VALIDATION_ERROR");
  const reason = "P118 CANARY STAFF REASON amount short";
  const rejected = await admin.setDepositStatus(ADMIN(), a.id, { expectedRevision: rev, status: "REJECTED", reason }, { db });
  assert.equal(rejected.booking.depositStatus, "REJECTED");
  assert.equal(rejected.booking.revision, rev + 1);
  const same = await admin.setDepositStatus(ADMIN(), a.id, { expectedRevision: rev + 1, status: "REJECTED" }, { db });
  assert.equal(same.noChange, true);
  const audits = await owner.bookingAuditEvent.findMany({ where: { bookingId: a.id, action: "DEPOSIT_STATUS_CHANGED" } });
  assert.deepEqual(audits.map((x) => [x.fromDepositStatus, x.toDepositStatus, x.fromRevision, x.toRevision, x.actorStaffId, x.reason]), [["PROOF_SENT", "REJECTED", rev, rev + 1, adminId, reason]]);
  const view = success(await management.readManagedBooking(options(a.token)));
  assert.deepEqual(view.deposit, { status: "REJECTED", proofsSent: 1, proofsAllowed: 3, message: "Please contact the shop." });
  assert.equal(JSON.stringify(view).includes("CANARY"), false, "staff reason reached the customer");
  // A new proof resets the status to PROOF_SENT; then ADMIN marks it received.
  success(await upload(a.token, proofBody(a.id, png(3, 3))));
  assert.equal((await owner.booking.findUniqueOrThrow({ where: { id: a.id } })).depositStatus, "PROOF_SENT");
  const received = await admin.setDepositStatus(ADMIN(), a.id, { expectedRevision: await revision(a.id), status: "RECEIVED" }, { db });
  assert.equal(received.booking.depositStatus, "RECEIVED");
  const board = await admin.getDayBoard(STAFF(), { date: day(4) }, { db });
  assert.equal(board.queues.flatMap((q) => q.waiting).find((card) => card.id === a.id)?.depositStatus, "RECEIVED");
  // REJECTED needs an actual proof; RECEIVED without one is allowed (paid at the shop) and does
  // not open the way to a rejection (review F2: NONE -> RECEIVED -> REJECTED is refused).
  const b = await fresh(), r = await revision(b.id);
  const notManageable = (rev: number, status: string) => (e: { code?: string; status?: number; currentBooking?: { revision: number; depositStatus: string } }) =>
    e.code === "BOOKING_NOT_MANAGEABLE" && e.status === 409 && e.currentBooking?.revision === rev && e.currentBooking?.depositStatus === status;
  await assert.rejects(admin.setDepositStatus(ADMIN(), b.id, { expectedRevision: r, status: "REJECTED" }, { db }), notManageable(r, "NONE"));
  assert.equal((await admin.setDepositStatus(ADMIN(), b.id, { expectedRevision: r, status: "RECEIVED" }, { db })).booking.depositStatus, "RECEIVED");
  await assert.rejects(admin.setDepositStatus(ADMIN(), b.id, { expectedRevision: r + 1, status: "REJECTED", reason: "P118 no proof" }, { db }), notManageable(r + 1, "RECEIVED"));
  const unchanged = await owner.booking.findUniqueOrThrow({ where: { id: b.id } });
  assert.deepEqual([unchanged.depositStatus, unchanged.revision, await proofCount(b.id)], ["RECEIVED", r + 1, 0]);
  const history = await owner.bookingAuditEvent.findMany({ where: { bookingId: b.id, action: "DEPOSIT_STATUS_CHANGED" } });
  assert.deepEqual(history.map((x) => [x.fromDepositStatus, x.toDepositStatus, x.fromRevision, x.toRevision]), [["NONE", "RECEIVED", r, r + 1]]);
});

test("the database refuses a deposit status change without its cause (no audit, no proof, back to NONE)", { skip }, async () => {
  const a = await fresh();
  for (const sql of [
    `UPDATE bookings SET "depositStatus"='RECEIVED', revision=revision+1 WHERE id=$1`,
    `UPDATE bookings SET "depositStatus"='PROOF_SENT', revision=revision+1 WHERE id=$1`,
  ]) await assert.rejects(owner.$executeRawUnsafe(sql, a.id), /deposit/i);
  success(await upload(a.token, proofBody(a.id, png())));
  await assert.rejects(owner.$executeRawUnsafe(`UPDATE bookings SET "depositStatus"='NONE', revision=revision+1 WHERE id=$1`, a.id), /NONE/);
  await assert.rejects(owner.$executeRawUnsafe(`UPDATE booking_deposit_proofs SET data='\\x00' WHERE "bookingId"=$1`, a.id), /immutable/);
  await assert.rejects(db.$executeRawUnsafe(`DELETE FROM booking_deposit_proofs WHERE "bookingId"=$1`, a.id), /permission denied/);
  await assert.rejects(db.$executeRawUnsafe(`UPDATE booking_deposit_proofs SET "contentType"='text/html' WHERE "bookingId"=$1`, a.id), /permission denied/);
  // REJECTED needs a stored proof even with a well-formed ADMIN audit row in the same transaction.
  const n = await fresh(), r = await revision(n.id);
  await assert.rejects(owner.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(746001,1)");
    await tx.bookingAuditEvent.create({ data: { action: "DEPOSIT_STATUS_CHANGED", bookingId: n.id, actorStaffId: adminId, fromDepositStatus: "NONE", toDepositStatus: "REJECTED", fromRevision: r, toRevision: r + 1 } });
    await tx.$executeRawUnsafe(`UPDATE bookings SET "depositStatus"='REJECTED', revision=revision+1 WHERE id=$1`, n.id);
  }), /REJECTED needs a deposit proof/);
  assert.equal((await owner.booking.findUniqueOrThrow({ where: { id: n.id } })).depositStatus, "NONE");
});

test("concurrent upload and ADMIN status change serialize: a decision on the older revision never hides a newer proof", { skip }, async () => {
  for (let round = 0; round < 4; round++) {
    const a = await fresh();
    success(await upload(a.token, proofBody(a.id, png(2, 2, [], undefined, round))));
    const rev = await revision(a.id);
    const [up, decision] = await Promise.allSettled([
      upload(a.token, proofBody(a.id, png(3, 3, [], undefined, round))),
      admin.setDepositStatus(ADMIN(), a.id, { expectedRevision: rev, status: "RECEIVED" }, { db }),
    ]);
    assert.equal(up.status === "fulfilled" && code(up.value), "OK");
    const final = await owner.booking.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(final.depositStatus, "PROOF_SENT", "the newest proof is still awaiting a decision");
    if (decision.status === "rejected") assert.equal((decision.reason as { code?: string }).code, "VERSION_CONFLICT");
    assert.equal(final.revision, rev + (decision.status === "fulfilled" ? 2 : 1));
  }
});

test("URL guessing: staff read refuses unknown ids, another booking's proof and malformed ids; the staff route needs a staff session", { skip }, async () => {
  const a = await fresh(), b = await fresh();
  success(await upload(a.token, proofBody(a.id, png())));
  const proofA = (await owner.bookingDepositProof.findFirstOrThrow({ where: { bookingId: a.id } })).id;
  await assert.rejects(admin.readDepositProof(ADMIN(), a.id, randomUUID(), { db }), (e: { code?: string }) => e.code === "NOT_FOUND");
  await assert.rejects(admin.readDepositProof(ADMIN(), b.id, proofA, { db }), (e: { code?: string }) => e.code === "NOT_FOUND");
  await assert.rejects(admin.readDepositProof(ADMIN(), a.id, "1", { db }), (e: { code?: string }) => e.code === "VALIDATION_ERROR");
  const route = await import("@/app/api/admin/bookings/[id]/deposit-proofs/[proofId]/route");
  const res = await route.GET(new NextRequest(c.origin + "/api/admin/bookings/" + a.id + "/deposit-proofs/" + proofA, { headers: headers(a.token) }),
    { params: Promise.resolve({ id: a.id, proofId: proofA }) });
  assert.equal(res.status, 401, "a customer management cookie is not a staff session");
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
});

test("canary: no public route or customer response returns a stored file", { skip }, async () => {
  const a = await fresh();
  // Pixel bytes survive sanitizing, so the canary lives in the stored image itself.
  const image = png(16, 1, [], undefined, 0x5a);
  success(await upload(a.token, proofBody(a.id, image)));
  const stored = Buffer.from((await owner.bookingDepositProof.findFirstOrThrow({ where: { bookingId: a.id } })).data);
  const needles = [stored.toString("base64").slice(10, 60), stored.toString("hex").slice(20, 80), stored.subarray(40, 70).toString("latin1")];
  const bodies: string[] = [];
  const opt = { db, config: c };
  for (const [action, method, body] of [["read", "GET", undefined], ["availability", "POST", { bookingId: a.id, fromDate: day(4), days: 3 }]] as const) {
    const res = await managementHttp(new Request(c.origin + "/api/bookings/manage", { method, headers: headers(a.token), ...(body ? { body: JSON.stringify(body) } : {}) }), action, opt);
    bodies.push(await res.text());
  }
  bodies.push(JSON.stringify(await upload(a.token, proofBody(a.id, image))));
  for (const text of bodies) for (const needle of needles) assert.equal(text.includes(needle), false);
  // Only the staff route reads the image column; no public route module touches proofs.
  const files: string[] = [];
  const walk = (dir: string) => { for (const f of readdirSync(dir)) { const p = path.join(dir, f); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
  walk(path.join(process.cwd(), "src", "app"));
  const readers = files.filter((f) => /depositProof|deposit-proofs|readDepositProof/.test(readFileSync(f, "utf8")));
  assert.deepEqual(readers.map((f) => path.relative(process.cwd(), f).replaceAll("\\", "/")).sort(), [
    "src/app/api/admin/bookings/[id]/deposit-proofs/[proofId]/route.ts",
    "src/app/api/bookings/manage/deposit-proofs/route.ts",
  ]);
  assert.equal(readFileSync(path.join(process.cwd(), "src/app/api/bookings/manage/deposit-proofs/route.ts"), "utf8").includes("GET"), false, "the customer route has no GET");
  for (const f of readdirSync(path.join(process.cwd(), "public"))) assert.equal(/proof|deposit/i.test(f), false, f);
});

test("the shop email says a proof was sent for a reference code, with no image and no customer details", { skip }, async () => {
  const smtp = await smtpSimulation("TLS");
  try {
    const a = await fresh();
    success(await upload(a.token, proofBody(a.id, png(8, 8, [], undefined, 0x33))));
    await drainDepositNotices({ db, notification: smtp.config, bookingId: a.id });
    const mail = smtp.messages.filter((m) => m.subject.includes(a.ref));
    const row0 = await owner.bookingDepositProof.findFirstOrThrow({ where: { bookingId: a.id }, select: { notifyState: true, notifyAttempts: true } });
    assert.equal(mail.length, 1, JSON.stringify({ subjects: smtp.messages.map((m) => m.subject), attempts: smtp.attempts.length, row0 }));
    assert.match(mail[0].subject, /deposit proof/i);
    assert.equal(mail[0].to, smtp.config.shopEmail);
    for (const secret of ["P118 PRIVATE NAME", "p118-private@example.test", "+63918", "P118 PLATE", "P118 PRIVATE MODEL", "P118 PRIVATE NOTES", "image/png", "base64", "Content-Disposition: attachment"])
      assert.equal(mail[0].raw.includes(secret), false, secret);
    const row = await owner.bookingDepositProof.findFirstOrThrow({ where: { bookingId: a.id } });
    assert.equal(row.notifyState, "SENT");
    await drainDepositNotices({ db, notification: smtp.config, bookingId: a.id });
    assert.equal(smtp.messages.filter((m) => m.subject.includes(a.ref)).length, 1, "sent once");
  } finally { await smtp.close(); }
});
