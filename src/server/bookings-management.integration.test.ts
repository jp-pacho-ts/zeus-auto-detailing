import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  createAndMigrate,
  mapPublisher,
  publish,
  siblingDatabaseUrl,
} from "./catalog-db.fixture";
import {
  bySlug,
  readManifest,
  releaseFromManifest,
  sizeId,
} from "./catalog.fixture";
import { getBookingQuote } from "./catalog-quote";
import { signQuote } from "./catalog-quote-token";
import { createDayBooking } from "./bookings-create";
import {
  parseBookingConfiguration,
  signManagementToken,
} from "./bookings-credentials";
import { sha256 } from "./bookings-hash";
import * as management from "./bookings-management";
import * as admin from "./admin";
import { managementHttp } from "./bookings-management-http";

const url = process.env.T007_TEST_DATABASE_URL,
  skip = !url;
const root = new PrismaClient({
  datasources: {
    db: { url: url ?? "postgresql://unused@localhost/zeus_t007_unused" },
  },
});
const db = new PrismaClient({
  datasources: {
    db: {
      url: url
        ? siblingDatabaseUrl(url, "management")
        : "postgresql://unused@localhost/zeus_t007_unused",
    },
  },
});
const c = parseBookingConfiguration({
  BOOKING_QUOTE_KEYS: "q:" + randomBytes(32).toString("base64url"),
  BOOKING_QUOTE_ACTIVE_KID: "q",
  MANAGEMENT_GRANT_KEYS: "g:" + randomBytes(32).toString("base64url"),
  MANAGEMENT_GRANT_ACTIVE_KID: "g",
  MANAGEMENT_SESSION_KEYS: "s:" + randomBytes(32).toString("base64url"),
  MANAGEMENT_SESSION_ACTIVE_KID: "s",
  ONLINE_BOOKING_MODE: "OPEN",
  TURNSTILE_SECRET_KEY: "synthetic_secret_for_local_management_checks",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "synthetic_site_key_for_management_checks",
  TURNSTILE_ALLOWED_HOSTNAMES: "localhost",
  APP_ORIGIN: "http://localhost:3000",
  CLIENT_IP_SOURCE: "PROXY_HOPS",
  TRUSTED_PROXY_HOPS: "1",
  NODE_ENV: "test",
});
const manifest = readManifest(),
  release = releaseFromManifest();
let server: Server,
  endpoint = "",
  seq = 0,
  actorId = "";
const day = (n = 4) =>
  new Date(Date.now() + 8 * 3600000 + n * 86400000).toISOString().slice(0, 10);
// P1-28: staff can start or seat a booking only on its day; 10:00 Manila on day(n).
const onDay = (n: number) => ({ db, now: () => new Date(day(n) + "T02:00:00.000Z") });
const headers = (token?: string) =>
  new Headers({
    origin: c.origin,
    "x-zeus-booking": "1",
    "content-type": "application/json",
    "x-forwarded-for":
      "192.0." + Math.floor(++seq / 250) + "." + ((seq % 250) + 1),
    ...(token ? { cookie: "booking-management=" + token } : {}),
  });
const options = (token?: string) => ({
  db,
  config: c,
  headers: headers(token),
});
const actor = () => ({
  staffId: actorId,
  role: "ADMIN" as const,
  sessionId: randomUUID(),
});
function success<T>(r: {
  result: { ok: true; data: T } | { ok: false; error: unknown };
}): T {
  assert.ok(r.result.ok, JSON.stringify(r.result));
  return r.result.ok ? r.result.data : (undefined as never);
}
const code = (r: { result: { ok: boolean; error?: { code: string } } }) =>
  r.result.ok ? "OK" : r.result.error!.code;
before(async () => {
  if (skip) return;
  assert.equal(process.env.DATABASE_URL, url);
  await createAndMigrate(root, siblingDatabaseUrl(url!, "management"));
  const tooling = await import(
    path.join(process.cwd(), "prisma/catalog/catalog.mjs")
  );
  actorId = await mapPublisher(db, "p104-admin@example.test");
  await publish(db, manifest, tooling.stableId);
  await db.scheduleConfig.create({
    data: { effectiveDate: new Date("2000-01-01") },
  });
  await db.timeSlot.createMany({
    data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      startTime: "08:00",
      endTime: "18:00",
      maxVehicleCapacity: 2,
    })),
  });
  server = createServer((req, res) => {
    req.resume();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        action: "booking_create",
        hostname: "localhost",
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = "http://127.0.0.1:" + (server.address() as { port: number }).port;
});
after(async () => {
  await db.$disconnect();
  await root.$disconnect();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
// `at` creates the booking at a simulated moment (server-only clock seam): since P1-19 today is
// closed after the shop's closing time, so a booking for today needs a moment before it.
async function fresh(offset = 4, at?: Date) {
  const selection = {
    vehicleCategoryId: sizeId(release, "S"),
    lines: [{ serviceId: bySlug(release, "basic-wash").id, quantity: 1 }],
  };
  const q = await getBookingQuote(selection, { db, ring: c.quote });
  assert.ok(q.ok);
  if (!q.ok) throw Error("quote");
  if (at) {
    const { quoteToken: _t, issuedAt: _i, expiresAt: _e, ...body } = q.data.quote;
    void _t;
    void _i;
    void _e;
    q.data.quote = signQuote(body, c.quote, at);
  }
  const n = ++seq,
    request = {
      contractVersion: 4 as const,
      idempotencyKey: randomUUID(),
      vehicleCategoryId: selection.vehicleCategoryId,
      lines: q.data.quote.lines.map((l) => ({
        serviceId: l.serviceId,
        quantity: l.quantity,
      })),
      bookingDate: day(offset),
      acceptedQuote: q.data.quote,
      turnstileToken: randomUUID(),
      customerName: "Private customer",
      customerPhone: "+63917" + String(n).padStart(7, "0"),
      vehicleModel: "Synthetic car",
      vehiclePlate: "PRIVATE PLATE",
      specialRequests: "PRIVATE NOTES",
    };
  const commit = await createDayBooking(request, {
    ...options(),
    turnstileEndpoint: endpoint,
    ...(at ? { now: at } : {}),
  });
  const data = success(commit);
  assert.ok(commit.session);
  assert.ok(data.managementAccess);
  return {
    request,
    id: data.booking.id,
    token: commit.session!.token,
    grant: data.managementAccess!.accessToken,
    view: data.booking,
  };
}
const noPrivate = (r: unknown) => {
  const text = JSON.stringify(r);
  for (const field of [
    "queuePosition",
    "dailyCap",
    "bayId",
    "occupancy",
    "assignedWorkers",
    "staffNote",
    "PRIVATE NOTES",
    "CANARY STAFF REASON",
    "workStatus",
    "customerPhone",
    "customerEmail",
    "customerName",
    "vehicleModel",
    "vehiclePlate",
    "PRIVATE PLATE",
  ])
    assert.equal(text.includes(field), false, field);
};

test(
  "P1-04 staff history merges customer effects, excludes no-ops/rejections/replays and receipt secrets",
  { skip },
  async () => {
    const a = await fresh();
    const move = {
      bookingId: a.id,
      idempotencyKey: randomUUID(),
      expectedRevision: 1,
      bookingDate: day(7),
    };
    success(await management.rescheduleManagedBooking(move, options(a.token)));
    success(
      await management.rescheduleManagedBooking(
        { ...move, idempotencyKey: randomUUID(), expectedRevision: 2 },
        options(a.token),
      ),
    );
    assert.equal(
      code(
        await management.rescheduleManagedBooking(
          { ...move, idempotencyKey: randomUUID(), bookingDate: day(8) },
          options(a.token),
        ),
      ),
      "VERSION_CONFLICT",
    );
    const cancel = {
      bookingId: a.id,
      idempotencyKey: randomUUID(),
      expectedRevision: 2,
    };
    success(await management.cancelManagedBooking(cancel, options(a.token)));
    success(await management.cancelManagedBooking(cancel, options(a.token)));
    const result = await admin.getBookingDetail(actor(), a.id, { db });
    const history = result.history;
    assert.deepEqual(
      history.map((h) => h.action),
      ["CUSTOMER_CANCELLED", "CUSTOMER_RESCHEDULED"],
    );
    assert.deepEqual(
      history.map((h) => h.toRevision),
      [3, 2],
    );
    assert.deepEqual(
      history.map((h) => h.fromRevision),
      [2, 1],
    );
    for (const h of history) {
      assert.equal(h.source, "CUSTOMER");
      assert.equal(h.actorStaffId, null);
      assert.equal(h.actorName, null);
      assert.equal(h.reason, null);
      assert.equal(h.lineId, null);
      assert.deepEqual(h.details, {});
    }
    // The database stamps one timestamp for this batch; ties use id and the cap is global.
    await db.bookingAuditEvent.createMany({
      data: Array.from({ length: 51 }, () => ({
        id: randomUUID(),
        bookingId: a.id,
        actorStaffId: actorId,
        action: "STATUS_CHANGED" as const,
        fromStatus: "PENDING" as const,
        toStatus: "CONFIRMED" as const,
        fromRevision: 1,
        toRevision: 2,
      })),
    });
    const bounded = (await admin.getBookingDetail(actor(), a.id, { db }))
      .history;
    const expected = [
      ...(
        await db.bookingAuditEvent.findMany({ where: { bookingId: a.id } })
      ).map((h) => ({ id: h.id, createdAt: h.createdAt.toISOString() })),
      ...history,
    ]
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
      )
      .slice(0, 50)
      .map((h) => h.id);
    assert.equal(bounded.length, 50);
    assert.deepEqual(
      bounded.map((h) => h.id),
      expected,
    );
    for (const h of bounded.filter((h) => h.source === "STAFF")) {
      assert.equal(h.actorStaffId, actorId);
      assert.equal(h.actorName, "Catalog Test Admin");
    }
    const serialized = JSON.stringify(history);
    for (const secret of [
      a.token,
      a.grant,
      move.idempotencyKey,
      cancel.idempotencyKey,
      "Private customer",
      "PRIVATE NOTES",
      "PRIVATE PLATE",
      "keyHash",
      "requestHash",
      "clientHash",
      "credentialVersion",
    ])
      assert.equal(serialized.includes(secret), false, secret);
  },
);

test(
  "P1-04 exchange/read: persisted provenance, cross-booking, grant retirement/revocation and minimal projection",
  { skip },
  async () => {
    const a = await fresh(),
      b = await fresh();
    const exchanged = await management.exchangeManagementAccess(
      { accessToken: a.grant },
      options(),
    );
    const data = success(exchanged);
    assert.equal(data.booking.id, a.id);
    assert.ok(exchanged.session);
    assert.equal(
      success(await management.readManagedBooking(options(a.token))).id,
      a.id,
    );
    noPrivate(data);
    assert.equal(
      code(
        await management.cancelManagedBooking(
          {
            bookingId: b.id,
            idempotencyKey: randomUUID(),
            expectedRevision: 1,
          },
          options(a.token),
        ),
      ),
      "UNAUTHENTICATED",
    );
    assert.equal(
      code(
        await management.exchangeManagementAccess(
          { accessToken: a.token },
          options(),
        ),
      ),
      "UNAUTHENTICATED",
    );
    const forged = signManagementToken(
      "BOOKING_MANAGEMENT",
      {
        bookingId: a.id,
        credentialVersion: 1,
        issuedAt: new Date(Date.now() - 1000).toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        grantKid: c.grant.activeKid,
      },
      c.grant,
    );
    assert.equal(
      code(
        await management.exchangeManagementAccess(
          { accessToken: forged },
          options(),
        ),
      ),
      "UNAUTHENTICATED",
    );
    const forgedSession = signManagementToken(
      "BOOKING_MANAGEMENT_SESSION",
      {
        bookingId: a.id,
        credentialVersion: 1,
        issuedAt: new Date(Date.now() - 1000).toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        grantKid: c.grant.activeKid,
      },
      c.session,
    );
    assert.equal(
      code(await management.readManagedBooking(options(forgedSession))),
      "UNAUTHENTICATED",
    );
    const retired = { ...c, grant: { ...c.grant, keys: new Map() } };
    assert.equal(
      code(
        await management.readManagedBooking({
          ...options(a.token),
          config: retired,
        }),
      ),
      "UNAUTHENTICATED",
    );
    await db.booking.update({
      where: { id: a.id },
      data: { managementTokenVersion: 2 },
    });
    const denied = await management.readManagedBooking(options(a.token));
    assert.equal(code(denied), "UNAUTHENTICATED");
    noPrivate(denied);
  },
);

test(
  "P1-04 recovery: CREATE authority, no reference lookup, fences prevent delayed create and management recovery cannot mint grants",
  { skip },
  async () => {
    const a = await fresh();
    const recovered = await management.recoverBookingOperation(
      {
        operationKind: "CREATE",
        bookingId: null,
        idempotencyKey: a.request.idempotencyKey.toUpperCase(),
      },
      options(),
    );
    const r = success(recovered);
    assert.equal(r.state, "COMMITTED");
    if (r.state === "COMMITTED") {
      assert.equal(r.booking.id, a.id);
      assert.ok(r.managementAccess);
    }
    noPrivate(recovered);
    assert.equal(
      code(
        await management.recoverBookingOperation(
          {
            referenceCode: a.view.referenceCode,
            customerPhone: a.request.customerPhone,
          },
          options(),
        ),
      ),
      "VALIDATION_ERROR",
    );
    const key = randomUUID();
    const fenced = success(
      await management.recoverBookingOperation(
        { operationKind: "CREATE", bookingId: null, idempotencyKey: key },
        options(),
      ),
    );
    assert.equal(fenced.state, "NOT_COMMITTED");
    assert.equal(
      (
        await db.bookingOperation.findUniqueOrThrow({
          where: { keyHash: sha256(key) },
        })
      ).outcome,
      "CLOSED_WITHOUT_COMMIT",
    );
    assert.equal(
      code(
        await createDayBooking(
          { ...a.request, idempotencyKey: key, turnstileToken: randomUUID() },
          { ...options(), turnstileEndpoint: endpoint },
        ),
      ),
      "OPERATION_CLOSED",
    );
    const cancel = {
      bookingId: a.id,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
    };
    success(await management.cancelManagedBooking(cancel, options(a.token)));
    const outcome = await management.recoverBookingOperation(
      {
        operationKind: "CANCEL",
        bookingId: a.id,
        idempotencyKey: cancel.idempotencyKey,
      },
      options(a.token),
    );
    const x = success(outcome);
    assert.equal(x.state, "COMMITTED");
    if (x.state === "COMMITTED") assert.equal(x.managementAccess, null);
    assert.equal(outcome.session, undefined);
    await db.booking.update({
      where: { id: a.id },
      data: { managementTokenVersion: 2 },
    });
    assert.equal(
      code(
        await management.recoverBookingOperation(
          {
            operationKind: "CREATE",
            bookingId: null,
            idempotencyKey: a.request.idempotencyKey,
          },
          options(),
        ),
      ),
      "UNAUTHENTICATED",
    );
  },
);

test(
  "P1-04 cancellation: one row/revision/receipt, replay, terminal no-op, cross-kind conflict and immutable receipt",
  { skip },
  async () => {
    const a = await fresh(),
      before = await db.booking.findUniqueOrThrow({ where: { id: a.id } });
    const input = {
      bookingId: a.id,
      idempotencyKey: randomUUID(),
      expectedRevision: 1,
    };
    const cancelled = success(
      await management.cancelManagedBooking(input, options(a.token)),
    );
    assert.equal(cancelled.booking.status, "CANCELLED");
    assert.equal(cancelled.booking.revision, 2);
    assert.equal(cancelled.noChange, false);
    const row = await db.booking.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(row.cancellationKind, "CUSTOMER");
    assert.equal(row.idempotencyKey, before.idempotencyKey);
    assert.equal(row.requestHash, before.requestHash);
    assert.equal(row.priceSnapshot.toString(), before.priceSnapshot.toString());
    assert.equal(
      success(await management.cancelManagedBooking(input, options(a.token)))
        .replayed,
      true,
    );
    assert.equal(
      success(
        await management.cancelManagedBooking(
          { ...input, idempotencyKey: randomUUID(), expectedRevision: 1 },
          options(a.token),
        ),
      ).noChange,
      true,
    );
    assert.equal(
      code(
        await management.rescheduleManagedBooking(
          { ...input, bookingDate: day(6) },
          options(a.token),
        ),
      ),
      "IDEMPOTENCY_CONFLICT",
    );
    const receipt = await db.bookingOperation.findUniqueOrThrow({
      where: { keyHash: sha256(input.idempotencyKey) },
    });
    const detail = await admin.getBookingDetail(actor(), a.id, { db });
    assert.deepEqual(
      detail.history.map((h) => h.action),
      ["CUSTOMER_CANCELLED"],
    );
    assert.equal(receipt.outcome, "COMMITTED");
    assert.equal(receipt.resultingRevision, 2);
    assert.equal(receipt.credentialVersion, 1);
    assert.equal(receipt.requestHash!.length, 64);
  },
);

test(
  "P1-04 reschedule: snapshot preservation, self exclusion, no-op, configured caps/closure and target/source cutoff",
  { skip },
  async () => {
    const a = await fresh(8),
      before = await db.booking.findUniqueOrThrow({ where: { id: a.id } }),
      lines = await db.bookingLineItem.findMany({ where: { bookingId: a.id } });
    await db.queueCapOverride.create({
      data: {
        queueCode: "WASH",
        date: new Date(day(8)),
        dailyCap: 1,
        updatedAt: new Date(),
        updatedByStaffId: actorId,
      },
    });
    const available = success(
      await management.getManagedDayAvailability(
        { bookingId: a.id, fromDate: day(8), days: 1 },
        options(a.token),
      ),
    );
    assert.equal(available.days[0].state, "AVAILABLE");
    noPrivate(available);
    const input = {
      bookingId: a.id,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      bookingDate: day(8),
    };
    assert.equal(
      success(
        await management.rescheduleManagedBooking(input, options(a.token)),
      ).noChange,
      true,
    );
    const move = {
      ...input,
      idempotencyKey: randomUUID(),
      bookingDate: day(9),
    };
    const moved = success(
      await management.rescheduleManagedBooking(move, options(a.token)),
    );
    assert.equal(moved.booking.bookingDate, day(9));
    assert.equal(moved.booking.revision, 2);
    const after = await db.booking.findUniqueOrThrow({ where: { id: a.id } });
    for (const field of [
      "referenceCode",
      "serviceId",
      "vehicleCategoryId",
      "queueCode",
      "idempotencyKey",
      "requestHash",
      "receiptTotalCentavos",
      "receiptEstimatedCentavos",
      "status",
    ] as const)
      assert.equal(after[field], before[field], field);
    assert.deepEqual(
      await db.bookingLineItem.findMany({ where: { bookingId: a.id } }),
      lines,
    );
    assert.equal(
      success(await management.rescheduleManagedBooking(move, options(a.token)))
        .replayed,
      true,
    );
    const b = await fresh(14);
    await db.queueCapOverride.create({
      data: {
        queueCode: "WASH",
        date: new Date(day(15)),
        dailyCap: 0,
        updatedAt: new Date(),
        updatedByStaffId: actorId,
      },
    });
    const rejected = {
      bookingId: b.id,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      bookingDate: day(15),
    };
    assert.equal(
      code(
        await management.rescheduleManagedBooking(rejected, options(b.token)),
      ),
      "FULLY_BOOKED",
    );
    assert.equal(
      (await db.booking.findUniqueOrThrow({ where: { id: b.id } })).bookingDate
        .toISOString()
        .slice(0, 10),
      day(14),
    );
    await db.blockedDate.create({
      data: {
        date: new Date(day(16)),
        reason: "CANARY STAFF REASON",
        isFullDay: true,
      },
    });
    const closed = await management.rescheduleManagedBooking(
      { ...rejected, idempotencyKey: randomUUID(), bookingDate: day(16) },
      options(b.token),
    );
    assert.equal(code(closed), "DAY_CLOSED");
    noPrivate(closed);
    assert.equal(
      code(
        await management.rescheduleManagedBooking(
          { ...rejected, idempotencyKey: randomUUID(), bookingDate: day(0) },
          options(b.token),
        ),
      ),
      "CUTOFF_PASSED",
    );
    // Today's booking is made at a moment already past and before closing: the real time before
    // 18:00 Manila, otherwise 17:00 (a session issued in the future is refused).
    const closing = new Date(day(0) + "T18:00:00+08:00");
    const today = await fresh(0, Date.now() < closing.getTime() ? undefined : new Date(day(0) + "T17:00:00+08:00"));
    assert.equal(
      code(
        await management.cancelManagedBooking(
          {
            bookingId: today.id,
            idempotencyKey: randomUUID(),
            expectedRevision: 1,
          },
          options(today.token),
        ),
      ),
      "CUTOFF_PASSED",
    );
  },
);

test(
  "P1-04 shop-only: occupied bay or started line refuses customer changes without releasing or modifying work",
  { skip },
  async () => {
    const a = await fresh(20),
      bay = await db.bay.create({
        data: {
          name: "P104 wash",
          nameKey: "p104 wash",
          bayType: "WASH",
          sortOrder: 1,
          updatedAt: new Date(),
        },
      });
    await admin.setBay(
      actor(),
      a.id,
      { expectedRevision: 1, date: day(20), bayId: bay.id },
      onDay(20),
    );
    for (const kind of ["CANCEL", "RESCHEDULE"]) {
      const input = {
        bookingId: a.id,
        idempotencyKey: randomUUID(),
        expectedRevision: 2,
        bookingDate: day(21),
      };
      if (kind === "CANCEL")
        delete (input as Partial<typeof input>).bookingDate;
      const result =
        kind === "CANCEL"
          ? await management.cancelManagedBooking(input, options(a.token))
          : await management.rescheduleManagedBooking(input, options(a.token));
      assert.equal(code(result), "BOOKING_NOT_MANAGEABLE");
      noPrivate(result);
    }
    assert.equal(
      (await db.bayOccupancy.findUniqueOrThrow({ where: { bookingId: a.id } }))
        .bayId,
      bay.id,
    );
    const b = await fresh(22),
      line = await db.bookingLineItem.findFirstOrThrow({
        where: { bookingId: b.id },
      });
    await admin.setLineStatus(
      actor(),
      b.id,
      line.id,
      { expectedRevision: 1, workStatus: "IN_PROGRESS" },
      onDay(22),
    );
    assert.equal(
      code(
        await management.cancelManagedBooking(
          {
            bookingId: b.id,
            idempotencyKey: randomUUID(),
            expectedRevision: 2,
          },
          options(b.token),
        ),
      ),
      "BOOKING_NOT_MANAGEABLE",
    );
  },
);

test(
  "P1-04 races: last target day and staff/customer revision serialize without losing a source booking",
  { skip },
  async () => {
    const a = await fresh(25),
      b = await fresh(26),
      target = day(27);
    await db.queueCapOverride.create({
      data: {
        queueCode: "WASH",
        date: new Date(target),
        dailyCap: 1,
        updatedAt: new Date(),
        updatedByStaffId: actorId,
      },
    });
    const results = await Promise.all(
      [a, b].map((x) =>
        management.rescheduleManagedBooking(
          {
            bookingId: x.id,
            idempotencyKey: randomUUID(),
            expectedRevision: 1,
            bookingDate: target,
          },
          options(x.token),
        ),
      ),
    );
    assert.equal(results.filter((r) => r.result.ok).length, 1);
    assert.equal(results.filter((r) => code(r) === "FULLY_BOOKED").length, 1);
    const x = await fresh(28);
    const race = await Promise.allSettled([
      management.cancelManagedBooking(
        { bookingId: x.id, idempotencyKey: randomUUID(), expectedRevision: 1 },
        options(x.token),
      ),
      admin.moveBooking(
        actor(),
        x.id,
        { expectedRevision: 1, toDate: day(29), toQueueCode: "WASH" },
        { db },
      ),
    ]);
    const booking = await db.booking.findUniqueOrThrow({ where: { id: x.id } });
    assert.equal(booking.revision, 2);
    assert.equal(
      race.filter(
        (r) =>
          r.status === "fulfilled" &&
          (r.value as { result?: { ok: boolean } }).result?.ok === false,
      ).length + race.filter((r) => r.status === "rejected").length,
      1,
    );
  },
);

test(
  "P1-04 I3: ADMIN day and queue changes release live occupancy, dated assignment and matching audit atomically",
  { skip },
  async () => {
    for (const [offset, toOffset, queue] of [
      [35, 34, "WASH"],
      [36, 38, "WASH"],
      [39, 39, "DETAILING_COATING"],
    ] as const) {
      const a = await fresh(offset),
        bay = await db.bay.create({
          data: {
            name: "I3 " + offset,
            nameKey: "i3 " + offset,
            bayType: "WASH",
            sortOrder: 1,
            updatedAt: new Date(),
          },
        });
      await admin.setBay(
        actor(),
        a.id,
        { expectedRevision: 1, date: day(offset + 2), bayId: bay.id },
        onDay(offset + 2),
      );
      const moved = await admin.moveBooking(
        actor(),
        a.id,
        { expectedRevision: 2, toDate: day(toOffset), toQueueCode: queue },
        { db },
      );
      assert.equal(moved.booking.occupancy, null);
      assert.equal(
        await db.bookingBayAssignment.count({ where: { bookingId: a.id } }),
        0,
      );
      assert.equal(
        await db.bookingAuditEvent.count({
          where: {
            bookingId: a.id,
            action: "BAY_UNASSIGNED",
            fromRevision: 2,
            toRevision: 3,
          },
        }),
        1,
      );
    }
  },
);

test(
  "P1-04 I3 database guard refuses a direct earlier-day move retaining physical occupancy",
  { skip },
  async () => {
    const a = await fresh(42),
      bay = await db.bay.create({
        data: {
          name: "I3 DB guard",
          nameKey: "i3 db guard",
          bayType: "WASH",
          sortOrder: 1,
          updatedAt: new Date(),
        },
      });
    await admin.setBay(
      actor(),
      a.id,
      { expectedRevision: 1, date: day(44), bayId: bay.id },
      onDay(44),
    );
    await assert.rejects(
      db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(746001,1)");
        await tx.booking.update({
          where: { id: a.id },
          data: {
            bookingDate: new Date(day(41)),
            startsAt: new Date(day(41) + "T00:00:00+08:00"),
            endsAt: new Date(
              Date.parse(day(41) + "T00:00:00+08:00") + 86400000,
            ),
            revision: 3,
          },
        });
      }),
      /release.*occupancy/i,
    );
    assert.equal(
      (await db.booking.findUniqueOrThrow({ where: { id: a.id } })).revision,
      2,
    );
  },
);

test(
  "P1-04 HTTP: generic auth/CSRF, strict input, no-store/no-referrer, secure cookie and forget",
  { skip },
  async () => {
    const a = await fresh(45),
      make = (method: string, body?: unknown, token?: string) =>
        new Request(c.origin + "/api/bookings/manage/session", {
          method,
          headers: headers(token),
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
    const response = await managementHttp(
      make("POST", { accessToken: a.grant }),
      "exchange",
      { db, config: c },
    );
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("set-cookie")!,
      /HttpOnly; SameSite=Strict/,
    );
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    const bad = make("POST", { accessToken: a.grant });
    bad.headers.set("origin", "https://evil.invalid");
    assert.equal(
      (await managementHttp(bad, "exchange", { db, config: c })).status,
      403,
    );
    assert.equal(
      (await managementHttp(make("GET"), "read", { db, config: c })).status,
      401,
    );
    assert.equal(
      (
        await managementHttp(
          make("POST", {
            referenceCode: a.view.referenceCode,
            customerPhone: a.request.customerPhone,
          }),
          "recovery",
          { db, config: c },
        )
      ).status,
      400,
    );
    // ADR-002 forget clears the browser cookie without a database phase; it is not grant revocation.
    const forget = await managementHttp(
      make("DELETE", undefined, a.token),
      "forget",
      { db, config: c },
    );
    assert.equal(forget.status, 204);
    assert.match(forget.headers.get("set-cookie")!, /Max-Age=0/);
    assert.equal(
      code(await management.readManagedBooking(options())),
      "UNAUTHENTICATED",
    );
  },
);

test(
  "P1-04 legacy recovery cannot fence an existing case-aliased historical key",
  { skip },
  async () => {
    const a = await fresh(50),
      source = await db.booking.findUniqueOrThrow({ where: { id: a.id } }),
      key = randomUUID();
    await db.booking.create({
      data: {
        referenceCode: "ZEUS-" + randomUUID().slice(0, 6).toUpperCase(),
        customerName: "Legacy fixture",
        customerPhone: "+639170000001",
        vehicleModel: "Legacy car",
        vehicleCategoryId: source.vehicleCategoryId,
        serviceId: source.serviceId,
        bookingDate: new Date(day(50)),
        startTime: "08:00",
        endTime: "08:30",
        startsAt: new Date(day(50) + "T00:00:00Z"),
        endsAt: new Date(day(50) + "T00:30:00Z"),
        durationMinutes: 30,
        priceSnapshot: 180,
        serviceNameSnapshot: "Legacy wash",
        vehicleCategoryNameSnapshot: "Small",
        idempotencyKey: key.toUpperCase(),
        requestHash: "legacy-fixture",
        updatedAt: new Date(),
      },
    });
    const r = await management.recoverBookingOperation(
      { operationKind: "CREATE", bookingId: null, idempotencyKey: key },
      options(),
    );
    assert.equal(code(r), "RECOVERY_UNAVAILABLE");
    assert.equal(r.session, undefined);
    assert.equal(
      await db.bookingOperation.count({ where: { keyHash: sha256(key) } }),
      0,
    );
  },
);

test(
  "P1-04 aborted read dispatches no database work and releases admission for the next valid read",
  { skip },
  async () => {
    const a = await fresh(51),
      controller = new AbortController();
    controller.abort();
    let calls = 0;
    const fake = {
      $transaction: async () => {
        calls++;
        throw Error("must not dispatch");
      },
    } as unknown as PrismaClient;
    const r = await management.readManagedBooking({
      ...options(a.token),
      db: fake,
      signal: controller.signal,
    });
    assert.equal(code(r), "RETRYABLE_ERROR");
    assert.equal(calls, 0);
    assert.equal(
      success(await management.readManagedBooking(options(a.token))).id,
      a.id,
    );
  },
);

test(
  "P1-04 durable booking limits refuse UNKNOWN without a row while terminal outcomes remain readable",
  { skip },
  async () => {
    const a = await fresh(52),
      keys = Array.from({ length: 6 }, () => randomUUID());
    await db.bookingOperation.createMany({
      data: keys.map((key) => ({
        keyHash: sha256(key),
        kind: "CANCEL",
        bookingId: a.id,
        credentialVersion: 1,
        outcome: "CLOSED_WITHOUT_COMMIT",
        recoveryExpiresAt: new Date(Date.now() + 86400000),
      })),
    });
    const key = randomUUID(),
      r = await management.cancelManagedBooking(
        { bookingId: a.id, expectedRevision: 1, idempotencyKey: key },
        options(a.token),
      );
    assert.equal(code(r), "RATE_LIMITED");
    if (!r.result.ok) assert.equal(r.result.error.commitState, "UNKNOWN");
    assert.equal(
      await db.bookingOperation.count({ where: { keyHash: sha256(key) } }),
      0,
    );
    assert.equal(
      (await db.booking.findUniqueOrThrow({ where: { id: a.id } })).revision,
      1,
    );
    const terminal = success(
      await management.recoverBookingOperation(
        { operationKind: "CANCEL", bookingId: a.id, idempotencyKey: keys[0] },
        options(a.token),
      ),
    );
    assert.equal(terminal.state, "NOT_COMMITTED");
  },
);

test(
  "P1-04 terminal CREATE recovery remains lock-free while a writer holds the shop lock",
  { skip },
  async () => {
    const a = await fresh(55);
    let unlock!: () => void, ready!: () => void;
    const held = new Promise<void>((resolve) => {
        unlock = resolve;
      }),
      locked = new Promise<void>((resolve) => {
        ready = resolve;
      });
    const writer = db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(746001,1)");
        ready();
        await held;
      },
      { timeout: 10000 },
    );
    await locked;
    try {
      const r = await management.recoverBookingOperation(
        {
          operationKind: "CREATE",
          bookingId: null,
          idempotencyKey: a.request.idempotencyKey,
        },
        options(),
      );
      assert.equal(success(r).state, "COMMITTED");
    } finally {
      unlock();
      await writer;
    }
  },
);

test(
  "P1-04 zeus_app can exchange, read, reschedule and cancel through the authorized services",
  { skip },
  async () => {
    const a = await fresh(56),
      runtimeUrl = new URL(siblingDatabaseUrl(url!, "management"));
    runtimeUrl.username = "zeus_app";
    const runtime = new PrismaClient({
      datasources: { db: { url: runtimeUrl.toString() } },
    });
    try {
      const opts = { ...options(a.token), db: runtime };
      assert.equal(
        success(
          await management.exchangeManagementAccess(
            { accessToken: a.grant },
            opts,
          ),
        ).booking.id,
        a.id,
      );
      assert.equal(
        success(
          await management.readManagedBooking({
            ...opts,
            headers: headers(a.token),
          }),
        ).id,
        a.id,
      );
      const moved = success(
        await management.rescheduleManagedBooking(
          {
            bookingId: a.id,
            idempotencyKey: randomUUID(),
            expectedRevision: 1,
            bookingDate: day(57),
          },
          { ...opts, headers: headers(a.token) },
        ),
      );
      assert.equal(moved.booking.revision, 2);
      const cancelled = success(
        await management.cancelManagedBooking(
          {
            bookingId: a.id,
            idempotencyKey: randomUUID(),
            expectedRevision: 2,
          },
          { ...opts, headers: headers(a.token) },
        ),
      );
      assert.equal(cancelled.booking.status, "CANCELLED");
    } finally {
      await runtime.$disconnect();
    }
  },
);

// Last: synthetic owner-written rows saturate non-fence shares without consuming reserved headroom.
test(
  "P1-04 reserved fence headroom survives anonymous and management receipt saturation",
  { skip },
  async () => {
    const a = await fresh(53),
      other = await fresh(54),
      now = new Date();
    const scoped = await db.bookingOperation.count({
      where: {
        kind: { in: ["CANCEL", "RESCHEDULE"] },
        outcome: { not: "CLOSED_WITHOUT_COMMIT" },
        createdAt: { gt: new Date(now.getTime() - 3600000) },
      },
    });
    await db.bookingOperation.createMany({
      data: Array.from({ length: Math.max(0, 80 - scoped) }, () => ({
        keyHash: sha256(randomUUID()),
        kind: "CANCEL",
        bookingId: other.id,
        credentialVersion: 1,
        requestHash: sha256("fixture"),
        outcome: "COMMITTED",
        resultingRevision: 1,
        noChange: true,
        committedAt: now,
        recoveryExpiresAt: new Date(now.getTime() + 86400000),
      })),
    });
    const r = await management.cancelManagedBooking(
      { bookingId: a.id, idempotencyKey: randomUUID(), expectedRevision: 1 },
      options(a.token),
    );
    assert.equal(code(r), "RETRYABLE_ERROR");
    if (!r.result.ok) assert.equal(r.result.error.commitState, "UNKNOWN");
    assert.equal(
      success(
        await management.recoverBookingOperation(
          {
            operationKind: "CANCEL",
            bookingId: a.id,
            idempotencyKey: randomUUID(),
          },
          options(a.token),
        ),
      ).state,
      "NOT_COMMITTED",
    );
    await db.bookingOperation.createMany({
      data: Array.from({ length: 50 }, () => ({
        keyHash: sha256(randomUUID()),
        kind: "CREATE",
        requestHash: sha256("fixture"),
        outcome: "REJECTED",
        rejectionCode: "DAY_CLOSED",
        recoveryExpiresAt: new Date(now.getTime() + 86400000),
      })),
    });
    assert.equal(
      success(
        await management.recoverBookingOperation(
          {
            operationKind: "CREATE",
            bookingId: null,
            idempotencyKey: randomUUID(),
          },
          options(),
        ),
      ).state,
      "NOT_COMMITTED",
    );
    assert.equal(
      success(
        await management.recoverBookingOperation(
          {
            operationKind: "CREATE",
            bookingId: null,
            idempotencyKey: a.request.idempotencyKey,
          },
          options(),
        ),
      ).state,
      "COMMITTED",
    );
  },
);
