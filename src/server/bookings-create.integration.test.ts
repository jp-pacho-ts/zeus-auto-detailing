import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAndMigrate, mapPublisher, publish, siblingDatabaseUrl } from "./catalog-db.fixture";
import { bySlug, readManifest, releaseFromManifest, sizeId } from "./catalog.fixture";
import { getBookingQuote } from "./catalog-quote";
import { parseBookingConfiguration, verifyManagementToken } from "./bookings-credentials";
import { createDayBooking, type CreateDayBookingOptions } from "./bookings-create";
import { getDayAvailability } from "./availability-public";
import { bookingPost } from "./bookings-http";
import { sendTurnNotice, drainShopNotifications } from "./notifications/bookings";
import { sha256 } from "./bookings-hash";
import { smtpSimulation, type SimulatedEmail } from "./notifications/smtp.fixture";
const url = process.env.T007_TEST_DATABASE_URL, skip = !url;
const root = new PrismaClient({ datasources: { db: { url: url ?? "postgresql://unused@localhost/zeus_t007_unused" } } });
const clients: PrismaClient[] = [];
let server: Server, endpoint = "", sequence = 0;
let smtp: Awaited<ReturnType<typeof smtpSimulation>>;
let emails: SimulatedEmail[]=[];
const proofs:string[]=[];
const manifest = readManifest(), release = releaseFromManifest();
const config = parseBookingConfiguration({
    BOOKING_QUOTE_KEYS: "q:" + randomBytes(32).toString("base64url"), BOOKING_QUOTE_ACTIVE_KID: "q", MANAGEMENT_GRANT_KEYS: "g:" + randomBytes(32).toString("base64url"), MANAGEMENT_GRANT_ACTIVE_KID: "g", MANAGEMENT_SESSION_KEYS: "s:" + randomBytes(32).toString("base64url"), MANAGEMENT_SESSION_ACTIVE_KID: "s", ONLINE_BOOKING_MODE: "OPEN", TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA", TURNSTILE_ALLOWED_HOSTNAMES: "localhost", APP_ORIGIN: "http://localhost:3000", CLIENT_IP_SOURCE: "PROXY_HOPS", TRUSTED_PROXY_HOPS: "1", NODE_ENV: "test"
});
const day = (offset = 1) => new Date(Date.now() + 8 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
const headers = () => new Headers({
    origin: config.origin, "x-zeus-booking": "1", "content-type": "application/json", "x-forwarded-for": "attacker, 192.0.2." + (++sequence)
});
before(async () => {
    if (skip)
        return;
    assert.equal(url, process.env.DATABASE_URL);
    server = createServer(async (req, res) => {
        let body = "";
        for await (const c of req)
            body += c;
        if (req.url === "/siteverify") {
            const token = new URLSearchParams(body).get("response")!;
            proofs.push(token);
            res.writeHead(token === "down" ? 503 : 200, { "content-type": "application/json" });
            res.end(JSON.stringify({
                success: token !== "invalid", action: "booking_create", hostname: "localhost"
            }));
        }
        else {
            res.writeHead(501);
            res.end();
        }
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    smtp=await smtpSimulation();emails=smtp.attempts;
    endpoint = "http://127.0.0.1:" + (server.address() as {
        port: number;
    }).port;
});
after(async () => {
    for (const c of clients)
        await c.$disconnect();
    await root.$disconnect();
    if(smtp)await smtp.close();
    if (server) {
        server.closeAllConnections();
        await new Promise<void>(r => server.close(() => r()));
    }
});
async function fixture(suffix: string) {
    const dbUrl = siblingDatabaseUrl(url!, suffix), db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    clients.push(db);
    await createAndMigrate(root, dbUrl);
    const tooling = await import(path.join(process.cwd(), "prisma", "catalog", "catalog.mjs"));
    const actor = await mapPublisher(db, suffix + "@example.test");
    await publish(db, manifest, tooling.stableId);
    await db.$executeRaw `UPDATE booking_queues SET "dailyCap"=50, revision=revision+1,"updatedAt"=now(),"updatedByStaffId"=${actor}`;
    await db.scheduleConfig.create({ data: { effectiveDate: new Date("2000-01-01") } });
    await db.timeSlot.createMany({ data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
            dayOfWeek, startTime: "08:00", endTime: "18:00", maxVehicleCapacity: 2
        })) });
    const options: CreateDayBookingOptions = {
        db, config, headers: headers(), turnstileEndpoint: endpoint + "/siteverify", notification: {
            ...smtp.config, origin: config.origin
        }
    };
    async function request(slugs = ["basic-wash"], date = day()) {
        const selection = { vehicleCategoryId: sizeId(release, "S"), lines: slugs.map(slug => ({ serviceId: bySlug(release, slug).id, quantity: slug === "panel-repaint" ? 3 : 1 })) };
        const quoted = await getBookingQuote(selection, { db, ring: config.quote });
        assert.ok(quoted.ok, JSON.stringify(quoted));
        if (!quoted.ok)
            throw Error("quote");
        return {
            contractVersion: 4 as const, idempotencyKey: randomUUID(), vehicleCategoryId: selection.vehicleCategoryId, lines: quoted.data.quote.lines.map(l => ({ serviceId: l.serviceId, quantity: l.quantity })), bookingDate: date, acceptedQuote: quoted.data.quote, turnstileToken: randomUUID(), customerName: "  CANARY CUSTOMER ", customerPhone: "+639170000001", customerEmail: "canary@example.test", vehicleModel: "Test Car", vehiclePlate: " PRIVATE PLATE ", specialRequests: "PRIVATE NOTES"
        };
    }
    const create = (r: unknown, h = headers(), extra: Partial<CreateDayBookingOptions> = {}) => createDayBooking(r, {
        ...options, ...extra, headers: h
    });
    return {
        db, dbUrl, options, request, create, actor
    };
}
const code = (r: Awaited<ReturnType<typeof createDayBooking>>) => r.result.ok ? "OK" : r.result.error.code;
const noPrivate = (value: unknown) => {
    const text = JSON.stringify(value);
    for (const word of [
        "CANARY STAFF REASON", "remainingCapacity", "dailyCap", "queuePosition", "bayCapacityRequired", "PRIVATE NOTES", "PRIVATE PLATE", "customerPhone", "customerEmail"
    ])
        assert.equal(text.includes(word), false, word);
};
test("last day unit race, immutable normalized snapshots, terminal replay and frozen-payload conflict", { skip }, async () => {
    const f = await fixture("race");
    await f.db.queueCapOverride.create({ data: {
            queueCode: "WASH", date: new Date(day()), dailyCap: 1, updatedAt: new Date(), updatedByStaffId: f.actor
        } });
    await f.db.$executeRaw `UPDATE booking_queues SET "dailyCap"=NULL,revision=revision+1,"updatedAt"=now() WHERE code<>'WASH'`;
    const a = await f.request(), b = { ...await f.request(), customerPhone: "+639170000002" };
    const results = await Promise.all([f.create(a), f.create(b)]);
    assert.equal(results.filter(r => r.result.ok).length, 1);
    assert.ok(results.some(r => code(r) === "FULLY_BOOKED"));
    const row = await f.db.booking.findFirstOrThrow();
    assert.equal(row.snapshotVersion, "QUEUE_V3");
    assert.equal(row.startTime, null);
    assert.equal(row.durationMinutes, null);
    assert.equal(row.queuePosition, 1);
    assert.equal(row.customerName, "CANARY CUSTOMER");
    assert.equal(row.vehiclePlate, "PRIVATE PLATE");
    assert.equal(/^[a-f0-9]{64}$/.test(row.idempotencyKey),true,"New bookings store only the operation-key digest");
    const frozen = row.idempotencyKey === sha256(a.idempotencyKey) ? a : b, priorCalls = proofs.length, mailCount = emails.length;
    const retry = await f.create({ ...frozen, turnstileToken: "fresh" }, headers(), { config: { ...config, mode: "PAUSED" } });
    assert.equal(code(retry), "OK");
    assert.equal(retry.created, false);
    assert.equal(proofs.length, priorCalls);
    assert.equal(emails.length, mailCount);
    if (retry.result.ok) {
        assert.equal(retry.result.data.replayed, true);
        noPrivate(retry.result);
        assert.ok(retry.result.data.managementAccess);
        assert.ok(verifyManagementToken(retry.result.data.managementAccess!.accessToken, "BOOKING_MANAGEMENT", config, new Date()));
    }
    assert.equal(code(await f.create({ ...frozen, customerName: "Different" })), "IDEMPOTENCY_CONFLICT");
    assert.equal(await f.db.booking.count(), 1);
    assert.equal(await f.db.bookingOperation.count({ where: { outcome: "COMMITTED" } }), 1);
    assert.equal(await f.db.bookingNotificationOutbox.count(), 1);
});
test("day allowlist, NULL-cap full, full closure canaries, partial block ignored, next day and stale create", { skip }, async () => {
    const f = await fixture("days"), r = await f.request();
    await f.db.blockedDate.create({ data: { date: new Date(day()), reason: "CANARY STAFF REASON" } });
    await f.db.blockedDate.create({ data: {
            date: new Date(day(2)), isFullDay: false, startTime: "08:00", endTime: "18:00", reason: "CANARY STAFF REASON"
        } });
    const selection = {
        vehicleCategoryId: r.vehicleCategoryId, lines: r.lines, fromDate: day(), days: 3
    };
    const a = await getDayAvailability(selection, f.options);
    assert.ok(a.ok, JSON.stringify(a));
    if (a.ok) {
        assert.deepEqual(a.data.days.map(d => d.state), ["CLOSED", "AVAILABLE", "AVAILABLE"]);
        assert.equal(a.data.nextAvailableDay, day(2));
        noPrivate(a);
    }
    const stale = await f.create(r);
    assert.equal(code(stale), "DAY_CLOSED");
    noPrivate(stale.result);
    await f.db.$executeRaw `UPDATE booking_queues SET "dailyCap"=NULL,revision=revision+1,"updatedAt"=now() WHERE code='WASH'`;
    const full = await f.create({ ...await f.request(["basic-wash"], day(2)), customerPhone: "+639170000003" });
    assert.equal(code(full), "FULLY_BOOKED");
    noPrivate(full.result);
});
test("multi-service priced/reference/panel snapshots stay server priced and primary binds the queue", { skip }, async () => {
    const f = await fixture("lines"), r = await f.request(["arcane-graphene", "basic-wash", "panel-repaint"]);
    const result = await f.create(r);
    assert.equal(code(result), "OK", JSON.stringify(result));
    const row = await f.db.booking.findFirstOrThrow({ include: { lineItems: { orderBy: { order: "asc" } } } });
    assert.equal(row.queueCode, "DETAILING_COATING");
    assert.equal(row.lineItems.length, 3);
    assert.equal(row.lineItems[0].priceStatus, "FOR_QUOTE");
    const panel = row.lineItems.find(l => l.unit === "PANEL")!;
    assert.equal(panel.quantity, 3);
    assert.equal(panel.subtotalCentavos, null);
    assert.equal(panel.referenceSubtotalCentavos, 1050000);
    assert.equal(row.receiptTotalCentavos, r.acceptedQuote.totalPriceCentavos);
    assert.equal(row.receiptEstimatedCentavos, r.acceptedQuote.estimatedTotalCentavos);
    assert.equal(code(await f.create({
        ...r, idempotencyKey: randomUUID(), acceptedQuote: { ...r.acceptedQuote, totalPriceCentavos: 1 }
    })), "VALIDATION_ERROR");
});
test("rejected quote is durable and exact retries stay rejected; invalid challenge/provider fail create no receipt", { skip }, async () => {
    const f = await fixture("reject"), r = await f.request();
    for (const [token, expected] of [["invalid", "CHALLENGE_FAILED"], ["down", "ONLINE_BOOKING_UNAVAILABLE"]])
        assert.equal(code(await f.create({ ...r, turnstileToken: token })), expected);
    assert.equal(await f.db.bookingOperation.count(), 0);
    const expired = { ...r, acceptedQuote: { ...r.acceptedQuote } }; // authentic expired quote, signed with the real server key
    const { signQuote } = await import("./catalog-quote-token");
    const { quoteToken: _token, issuedAt: _issued, expiresAt: _expires, ...body } = r.acceptedQuote;
    void _token;
    void _issued;
    void _expires;
    expired.acceptedQuote = signQuote(body, config.quote, new Date(Date.now() - 16 * 60000));
    const bad = await f.create(expired);
    assert.equal(code(bad), "QUOTE_EXPIRED");
    assert.equal(!bad.result.ok && bad.result.error.commitState, "NOT_COMMITTED");
    const calls = proofs.length;
    assert.equal(code(await f.create({ ...expired, turnstileToken: "fresh" }, headers(), { config: { ...config, mode: "PAUSED" } })), "QUOTE_EXPIRED");
    assert.equal(proofs.length, calls);
    assert.equal(await f.db.bookingOperation.count(), 1);
});
test("phone cap includes IN_PROGRESS, client and shop burst budgets are exact, and same proof cannot make two effects", { skip }, async () => {
    const f = await fixture("budgets");
    const sameClient = headers();
    for (let i = 0; i < 2; i++)
        assert.equal(code(await f.create(await f.request(["basic-wash"], day(i + 1)), sameClient)), "OK");
    assert.equal(code(await f.create(await f.request(["basic-wash"], day(3)))), "BOOKING_LIMIT_REACHED");
    const reuse = await f.request(["basic-wash"], day(4));
    reuse.customerPhone = "+639170000002";
    assert.equal(code(await f.create(reuse, sameClient)), "OK");
    assert.equal(code(await f.create({ ...await f.request(["basic-wash"], day(5)), customerPhone: "+639170000003" }, sameClient)), "RATE_LIMITED");
    assert.equal(code(await f.create({
        ...reuse, idempotencyKey: randomUUID(), bookingDate: day(6), customerPhone: "+639170000004"
    })), "CHALLENGE_FAILED");
    for (let i = 0; i < 2; i++)
        assert.equal(code(await f.create({ ...await f.request(["basic-wash"], day(7 + i)), customerPhone: "+63917000000" + (5 + i) })), "OK");
    const calls = proofs.length;
    assert.equal(code(await f.create({ ...await f.request(["basic-wash"], day(9)), customerPhone: "+639170000009" })), "ONLINE_BOOKING_UNAVAILABLE");
    assert.equal(proofs.length, calls);
    assert.equal(await f.db.booking.count(), 5);
});
test("HTTP boundary rejects CSRF/old slots/unknown body fields; success is no-store and creates a bounded HttpOnly cookie", { skip }, async () => {
    const f = await fixture("http"), r = await f.request();
    const call = (value: unknown, h = new Headers(f.options.headers)) => bookingPost(new Request(config.origin + "/api/bookings", {
        method: "POST", headers: h, body: typeof value === "string" ? value : JSON.stringify(value)
    }), { ...f.options, headers: undefined });
    const missing = new Headers(f.options.headers);
    missing.delete("origin");
    assert.equal((await call(r, missing)).status, 403);
    assert.equal((await call("{broken")).status, 400);
    assert.equal((await call({ ...r, specialRequests: "x".repeat(17000) })).status, 400);
    assert.equal((await call({ ...r, queuePosition: 3 })).status, 400);
    assert.equal((await call({
        idempotencyKey: randomUUID(), vehicleCategoryId: r.vehicleCategoryId, serviceId: r.lines[0].serviceId, bookingDate: r.bookingDate, startTime: "08:00", customerName: r.customerName, customerPhone: r.customerPhone, vehicleModel: r.vehicleModel
    })).status, 400);
    const response = await call(r);
    assert.equal(response.status, 201, await response.clone().text());
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("set-cookie")!, /HttpOnly/);
    assert.match(response.headers.get("set-cookie")!, /SameSite=Strict/);
    noPrivate(await response.json());
    assert.equal((await call({ ...r, turnstileToken: "fresh" })).status, 200);
});
test("mail outage cannot roll back booking, retry uses one stable Message-ID, turn notices disclose no private values", { skip }, async () => {
    const f = await fixture("mail"), r = await f.request();
    smtp.setRejected(true);
    let result: Awaited<ReturnType<typeof f.create>>;
    try {
        result = await f.create(r);
    }
    finally {
        smtp.setRejected(false);
    }
    assert.equal(code(result), "OK");
    const b = await f.db.booking.findFirstOrThrow();
    assert.equal(await f.db.bookingNotificationOutbox.count({ where: { state: "SENT" } }), 0);
    await f.db.bookingNotificationOutbox.updateMany({ data: { nextAttemptAt: new Date(0) } });
    await drainShopNotifications({ ...f.options, bookingId: b.id });
    const outbox = await f.db.bookingNotificationOutbox.findFirstOrThrow();
    assert.equal(outbox.state, "SENT");
    const shop = emails.filter(e => e.messageId === `<booking-shop.${outbox.id}@localhost>`);
    assert.ok(shop.length >= 2);
    assert.equal(new Set(shop.map(e => e.text)).size, 1);
    for (const e of shop) {
        for (const privateValue of [
            "CANARY CUSTOMER", "canary@example.test", "+639170000001", "PRIVATE PLATE", "PRIVATE NOTES", "queuePosition", "dailyCap"
        ])
            assert.equal(e.text.includes(privateValue), false, privateValue);
    }
    assert.equal(await sendTurnNotice(b.id, f.options), "SENT");
    const turn = emails.at(-1)!;
    const parsed = {to:[turn.to],text:turn.text};
    assert.equal(parsed.to[0], "canary@example.test");
    assert.equal(parsed.text, "Your turn is coming at Zeus Auto Detailing. Please be ready to visit the shop. Contact the shop if you need help.");
    noPrivate(parsed.text);
    smtp.setRejected(true);
    try {
        assert.equal(await sendTurnNotice(b.id, f.options), "NOT_SENT");
    }
    finally {
        smtp.setRejected(false);
    }
    await f.db.booking.update({ where: { id: b.id }, data: { customerEmail: null } });
    const n = emails.length;
    assert.equal(await sendTurnNotice(b.id, f.options), "NOT_SENT");
    assert.equal(emails.length, n);
});
test("recovery gate refuses expired or revoked authority and fences block a delayed create", { skip }, async () => {
    const f = await fixture("authority"), r = await f.request();
    const a = await f.create(r);
    assert.equal(code(a), "OK");
    const b = await f.db.booking.findFirstOrThrow();
    await f.db.booking.update({ where: { id: b.id }, data: { managementTokenVersion: 2 } });
    const denied = await f.create(r);
    assert.equal(code(denied), "UNAUTHENTICATED");
    assert.equal(!denied.result.ok && denied.result.error.commitState, "UNKNOWN");
    noPrivate(denied.result);
    const fenced = await f.request();
    await f.db.bookingOperation.create({ data: {
            keyHash: sha256(fenced.idempotencyKey), kind: "CREATE", outcome: "CLOSED_WITHOUT_COMMIT", recoveryExpiresAt: new Date()
        } });
    const calls = proofs.length;
    assert.equal(code(await f.create(fenced)), "OPERATION_CLOSED");
    assert.equal(proofs.length, calls);
    assert.equal(await f.db.booking.count(), 1);
});
test("legacy key case aliases cannot become new effects, and active legacy IN_PROGRESS rows count toward the phone cap", { skip }, async () => {
    const f = await fixture("legacy_boundary"), r = await f.request();
    const legacyKey = randomUUID().toUpperCase();
    const legacy = (key: string, referenceCode: string) => ({
        referenceCode, customerName: "Historical Synthetic", customerPhone: r.customerPhone, vehicleModel: "Test Car", vehicleCategoryId: r.vehicleCategoryId, serviceId: r.lines[0].serviceId, bookingDate: new Date(day()), startTime: "09:00", endTime: "10:00", startsAt: new Date(day() + "T09:00:00+08:00"), endsAt: new Date(day() + "T10:00:00+08:00"), durationMinutes: 60, priceSnapshot: 100, serviceNameSnapshot: "Historical", vehicleCategoryNameSnapshot: "S", idempotencyKey: key, requestHash: "historical", status: "IN_PROGRESS" as const
    });
    await f.db.booking.create({ data: legacy(legacyKey, "ZEUS-HIST02") });
    assert.equal(code(await f.create({
        ...r, idempotencyKey: legacyKey.toLowerCase(), customerPhone: "+639170000009"
    })), "IDEMPOTENCY_CONFLICT");
    await f.db.booking.create({ data: legacy(randomUUID(), "ZEUS-HIST03") });
    const limited = await f.create({
        ...r, idempotencyKey: randomUUID(), turnstileToken: randomUUID()
    });
    assert.equal(code(limited), "BOOKING_LIMIT_REACHED");
    assert.equal(!limited.result.ok && limited.result.error.commitState, "NOT_COMMITTED");
});
test("zeus_app can execute a real create and replay through its least-privilege grants", { skip }, async () => {
    const f = await fixture("runtime");
    await root.$executeRawUnsafe("ALTER ROLE zeus_app LOGIN");
    const appUrl = new URL(f.dbUrl);
    appUrl.username = "zeus_app";
    const app = new PrismaClient({ datasources: { db: { url: appUrl.toString() } } });
    clients.push(app);
    const r = await f.request();
    const result = await f.create(r, headers(), { db: app });
    assert.equal(code(result), "OK", JSON.stringify(result));
    const retry = await f.create({ ...r, turnstileToken: randomUUID() }, headers(), { db: app });
    assert.equal(code(retry), "OK", JSON.stringify(retry));
    assert.equal(retry.created, false);
});
test("catalog publication makes a stale quote a durable public rejection; cancelled positions are not reused", { skip }, async () => {
    const f = await fixture("stale");
    const r = await f.request();
    const first = await f.create(r);
    assert.equal(code(first), "OK");
    const row = await f.db.booking.findFirstOrThrow();
    await f.db.$transaction(async (tx) => { await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(746001,1)"); await tx.$executeRaw `UPDATE bookings SET status='CANCELLED',"cancellationKind"='CUSTOMER',"terminalAt"=now(),revision=revision+1 WHERE id=${row.id}`; });
    const replayed = await f.create(r);
    assert.equal(code(replayed), "OK");
    if (replayed.result.ok)
        assert.equal(replayed.result.data.booking.status, "CANCELLED");
    const second = await f.create({ ...await f.request(), customerPhone: "+639170000008" });
    assert.equal(code(second), "OK");
    const tail = await f.db.booking.findFirstOrThrow({ where: { id: { not: row.id } } });
    assert.equal(tail.queuePosition, 2);
    const stale = await f.request(["basic-wash"], day(3));
    const tooling = await import(path.join(process.cwd(), "prisma", "catalog", "catalog.mjs"));
    await publish(f.db, tooling.rollbackManifest(manifest, "p103-stale-release"), tooling.stableId);
    const result = await f.create({ ...stale, customerPhone: "+639170000009" });
    assert.equal(code(result), "CATALOG_UPDATED");
    noPrivate(result.result);
    assert.equal(!result.result.ok && result.result.error.commitState, "NOT_COMMITTED");
    assert.ok(!result.result.ok && result.result.error.currentQuote);
});
test("customer DB phases bound aborted reads, reject aborted admission, and finish started writes", { skip }, async () => {
    const f = await fixture("abort"), { withBookingDb } = await import("./bookings-admission");
    const controller = new AbortController(), start = Date.now();
    await assert.rejects(withBookingDb(f.db, "READ", async (tx) => { controller.abort(); return tx.$queryRawUnsafe("SELECT pg_sleep(5)"); }, controller.signal), /statement timeout|canceling statement/);
    assert.ok(Date.now() - start < 6000, "aborted read must remain bounded by its statement timeout");
    const already = new AbortController();
    already.abort();
    await assert.rejects(withBookingDb(f.db, "READ", tx => tx.$queryRawUnsafe("SELECT 1"), already.signal), /ABORTED/);
    const writing = new AbortController(), key = sha256(randomUUID());
    await withBookingDb(f.db, "CREATE", async (tx) => {
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(746001,1)");
        writing.abort();
        await tx.bookingOperation.create({ data: {
                keyHash: key, kind: "CREATE", outcome: "CLOSED_WITHOUT_COMMIT", recoveryExpiresAt: new Date()
            } });
    }, writing.signal);
    assert.ok(await f.db.bookingOperation.findUnique({ where: { keyHash: key } }));
    assert.equal(await withBookingDb(f.db, "READ", tx => tx.bookingOperation.count({ where: { keyHash: key } })), 1);
});
test("zero configured shop caps is definitively fully booked, and an aborted completed read is discarded", { skip }, async () => {
    const f = await fixture("zero"), r = await f.request();
    await f.db.$executeRawUnsafe('UPDATE booking_queues SET "dailyCap"=NULL,revision=revision+1,"updatedAt"=now()');
    assert.equal(code(await f.create(r)), "FULLY_BOOKED");
    const { withBookingDb } = await import("./bookings-admission"), controller = new AbortController();
    await assert.rejects(withBookingDb(f.db, "READ", async (tx) => { await tx.$queryRawUnsafe("SELECT 1"); controller.abort(); return "must not escape"; }, controller.signal), /ABORTED/);
});
test("anonymous rejection quota is durable and cannot consume terminal replay headroom", { skip }, async () => {
    const f = await fixture("anonymous"), r = await f.request(), h = headers(), { signQuote } = await import("./catalog-quote-token");
    const { quoteToken, issuedAt, expiresAt, ...body } = r.acceptedQuote;
    void quoteToken;
    void issuedAt;
    void expiresAt;
    const expired = signQuote(body, config.quote, new Date(Date.now() - 16 * 60000));
    const first = { ...r, acceptedQuote: expired };
    for (let i = 0; i < 5; i++) {
        const rejected = await f.create({
            ...first, idempotencyKey: i === 0 ? first.idempotencyKey : randomUUID(), turnstileToken: randomUUID()
        }, h);
        assert.equal(code(rejected), "QUOTE_EXPIRED");
    }
    const refused = await f.create({
        ...first, idempotencyKey: randomUUID(), turnstileToken: randomUUID()
    }, h);
    assert.equal(code(refused), "RETRYABLE_ERROR");
    assert.equal(!refused.result.ok && refused.result.error.commitState, "UNKNOWN");
    assert.equal(await f.db.bookingOperation.count(), 5);
    const calls = proofs.length;
    assert.equal(code(await f.create({ ...first, turnstileToken: "fresh" }, h, { config: { ...config, mode: "PAUSED" } })), "QUOTE_EXPIRED");
    assert.equal(proofs.length, calls);
    assert.equal(await f.db.booking.count(), 0);
});
test("legacy HTTP replay work still obeys trusted per-client transport admission", { skip }, async () => {
    const f = await fixture("legacy_transport"), r = await f.request(), h = headers(), legacy = { idempotencyKey: randomUUID(), vehicleCategoryId: r.vehicleCategoryId, serviceId: r.lines[0].serviceId, bookingDate: r.bookingDate, startTime: "08:00", customerName: r.customerName, customerPhone: r.customerPhone, vehicleModel: r.vehicleModel };
    let response: Response | undefined;
    for (let i = 0; i < 16; i++)
        response = await bookingPost(new Request(config.origin + "/api/bookings", { method: "POST", headers: h, body: JSON.stringify(legacy) }), f.options);
    assert.equal(response!.status, 429);
    const body = await response!.json();
    assert.equal(body.error.code, "RATE_LIMITED");
    assert.equal(body.error.commitState, "UNKNOWN");
    assert.equal(response!.headers.get("retry-after"), String(body.error.retryAfterSeconds));
    assert.equal(await f.db.booking.count(), 0);
});

test("F1 management authority is immutable as zeus_app and revocation is one-way", { skip }, async () => {
 const f=await fixture("immutable_authority");assert.equal(code(await f.create(await f.request())),"OK");
 const grant=await f.db.bookingManagementGrant.findFirstOrThrow(),session=await f.db.bookingManagementSession.findFirstOrThrow();
 const appUrl=new URL(f.dbUrl);appUrl.username="zeus_app";
 const app=new PrismaClient({datasources:{db:{url:appUrl.toString()}}});clients.push(app);
 for(const [table,row,changes] of [
  ["booking_management_grants",grant,{expiresAt:new Date(grant.expiresAt.getTime()+1000),issuedAt:new Date(grant.issuedAt.getTime()+1000),kid:"changed",bookingId:randomUUID(),credentialVersion:2,id:randomUUID()}],
  ["booking_management_sessions",session,{expiresAt:new Date(grant.expiresAt.getTime()+1000),issuedAt:new Date(session.issuedAt.getTime()+1000),kid:"changed",grantKid:"changed",bookingId:randomUUID(),grantId:randomUUID(),credentialVersion:2,id:randomUUID()}]
 ] as const){
  const original=await f.db.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS body FROM ${table} t WHERE id=$1`,row.id);
  for(const [column,value] of Object.entries(changes)){
   await assert.rejects(app.$executeRawUnsafe(`UPDATE ${table} SET "${column}"=$1 WHERE id=$2`,value,row.id),/permission denied|immutable|provenance/i,`${table}.${column}`);
   assert.deepEqual(await f.db.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS body FROM ${table} t WHERE id=$1`,row.id),original);
  }
 }
 // Revoke grant first, then session: revoking a session must still work after its grant.
 for(const [table,row] of [["booking_management_grants",grant],["booking_management_sessions",session]] as const){
  assert.equal(await app.$executeRawUnsafe(`UPDATE ${table} SET "revokedAt"=statement_timestamp() WHERE id=$1`,row.id),1);
  const revoked=await f.db.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS body FROM ${table} t WHERE id=$1`,row.id);
  for(const assignment of ['"revokedAt"=NULL','"revokedAt"=statement_timestamp()+interval \'1 day\'']){
   await assert.rejects(app.$executeRawUnsafe(`UPDATE ${table} SET ${assignment} WHERE id=$1`,row.id),/immutable/i);
   assert.deepEqual(await f.db.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS body FROM ${table} t WHERE id=$1`,row.id),revoked);
  }
  // Owner connection exercises the trigger defense independently of runtime column grants.
  await assert.rejects(f.db.$executeRawUnsafe(`UPDATE ${table} SET "issuedAt"="issuedAt"+interval '1 second' WHERE id=$1`,row.id),/immutable/i);
 }
});

test("F1 exact runtime UPDATE column grants and immutable outbox payload", { skip }, async()=>{
 const f=await fixture("immutable_privileges");assert.equal(code(await f.create(await f.request())),"OK");
 const allowed:Record<string,string[]>={booking_management_grants:["revokedAt"],booking_management_sessions:["revokedAt"],booking_notification_outbox:["state","attempts","nextAttemptAt","sentAt"]};
 for(const [table,columns] of Object.entries(allowed)){
  const rows=await f.db.$queryRaw<{column:string;allowed:boolean}[]>`SELECT column_name AS column,has_column_privilege('zeus_app',table_name,column_name,'UPDATE') AS allowed FROM information_schema.columns WHERE table_schema='public' AND table_name=${table}`;
  assert.deepEqual(rows.filter(r=>r.allowed).map(r=>r.column).sort(),[...columns].sort());
 }
 const appUrl=new URL(f.dbUrl);appUrl.username="zeus_app";const app=new PrismaClient({datasources:{db:{url:appUrl.toString()}}});clients.push(app);
 const outbox=await f.db.bookingNotificationOutbox.findFirstOrThrow();
 for(const column of ["subject","text","bookingId","id","createdAt"]){await assert.rejects(app.$executeRawUnsafe(`UPDATE booking_notification_outbox SET "${column}"="${column}" WHERE id=$1`,outbox.id),/permission denied/i)}
});
test("F2 SMTP acceptance then finalize failure reclaims once with the same outbox Message-ID", { skip }, async()=>{
 const f=await fixture("smtp_finalize"),r=await f.request();
 await f.db.$executeRawUnsafe('CREATE TABLE fixture_finalize_fault(enabled boolean NOT NULL)');
 await f.db.$executeRawUnsafe('INSERT INTO fixture_finalize_fault VALUES (true)');
 await f.db.$executeRawUnsafe(`CREATE FUNCTION fixture_finalize_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='SENT' AND (SELECT enabled FROM fixture_finalize_fault) THEN RAISE EXCEPTION 'Synthetic finalize failure'; END IF; RETURN NEW; END $$`);
 await f.db.$executeRawUnsafe('CREATE TRIGGER fixture_finalize_guard BEFORE UPDATE ON booking_notification_outbox FOR EACH ROW EXECUTE FUNCTION fixture_finalize_guard()');
 const first=await f.create(r);assert.equal(code(first),"OK");
 const b=await f.db.booking.findFirstOrThrow(),box=await f.db.bookingNotificationOutbox.findFirstOrThrow();
 assert.deepEqual([box.state,box.attempts],["SENDING",1]);
 const messageId=`<booking-shop.${box.id}@localhost>`;
 const accepted=()=>smtp.messages.filter(e=>e.messageId===messageId);
 assert.equal(accepted().length,1,"SMTP actually accepted before DB finalize failed");
 assert.equal(code(await f.create({...r,turnstileToken:randomUUID()})),"OK");assert.equal(accepted().length,1,"replay cannot enqueue/send again");
 await f.db.$executeRawUnsafe('UPDATE fixture_finalize_fault SET enabled=false');
 await f.db.bookingNotificationOutbox.update({where:{id:box.id},data:{nextAttemptAt:new Date(0)}});
 await drainShopNotifications({...f.options,bookingId:b.id});
 const sent=await f.db.bookingNotificationOutbox.findUniqueOrThrow({where:{id:box.id}});
 assert.deepEqual([sent.state,sent.attempts],["SENT",2]);assert.equal(accepted().length,2,"one residual resend after a single finalize failure");
 assert.deepEqual(accepted().map(e=>[e.messageId,e.subject,e.text]),Array.from({length:2},()=>[messageId,box.subject,box.text]));
 await drainShopNotifications({...f.options,bookingId:b.id});assert.equal(accepted().length,2);assert.equal(await f.db.bookingNotificationOutbox.count(),1);
});

test("F2 repeated accepted/finalize failures still cannot exceed three claimed sends", { skip }, async()=>{
 const f=await fixture("smtp_finalize_limit");
 await f.db.$executeRawUnsafe(`CREATE FUNCTION fixture_always_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='SENT' THEN RAISE EXCEPTION 'Synthetic finalize failure'; END IF; RETURN NEW; END $$`);
 await f.db.$executeRawUnsafe('CREATE TRIGGER fixture_always_fail BEFORE UPDATE ON booking_notification_outbox FOR EACH ROW EXECUTE FUNCTION fixture_always_fail()');
 assert.equal(code(await f.create(await f.request())),"OK");
 const box=await f.db.bookingNotificationOutbox.findFirstOrThrow(),key=`<booking-shop.${box.id}@localhost>`;
 for(let i=0;i<2;i++){
  await f.db.bookingNotificationOutbox.update({where:{id:box.id},data:{nextAttemptAt:new Date(0)}});
  await assert.rejects(drainShopNotifications({...f.options,bookingId:box.bookingId}),/Synthetic finalize failure/);
 }
 await f.db.bookingNotificationOutbox.update({where:{id:box.id},data:{nextAttemptAt:new Date(0)}});
 await drainShopNotifications({...f.options,bookingId:box.bookingId});
 assert.equal(smtp.messages.filter(e=>e.messageId===key).length,3);
 assert.equal((await f.db.bookingNotificationOutbox.findUniqueOrThrow({where:{id:box.id}})).attempts,3);
 assert.equal(await f.db.bookingNotificationOutbox.count(),1);
});