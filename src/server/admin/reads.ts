import "server-only";
import type { Prisma } from "@prisma/client";
import type {
  AdminBay,
  AdminBookingDetail,
  AdminBookingList,
  AdminBookingSearchResult,
  AdminDayQueues,
  AdminQueueCaps,
  AdminQueueDay,
} from "@/types/admin-contracts";
import {
  BookingListSchema,
  BookingSearchSchema,
  CapsQuerySchema,
  DayQueuesQuerySchema,
  AdminIdSchema,
} from "@/lib/admin-validation";
import { CustomerPhoneSchema } from "@/lib/validation";
import { withStaffDb } from "@/server/auth/db-admission";
import {
  authorize,
  dateCarrier,
  isoDay,
  parse,
  type AdminOptions,
  type StaffActor,
} from "./context";
import { closedDay, committed } from "./capacity";
import { decodeCursor, encodeCursor, filterHash } from "./cursor";
import { AdminServiceError, fieldError } from "./errors";
import { bookingInclude, loadDetail, toQueueBooking } from "./views";

// Staff reads (STAFF or ADMIN): one STAFF_READ permit, one read transaction each.
function read<T>(
  options: AdminOptions,
  work: Parameters<typeof withStaffDb<T>>[1],
): Promise<T> {
  return withStaffDb("STAFF_READ", work, {
    access: "read",
    db: options.db,
    signal: options.signal,
  });
}

export async function getDayQueues(
  actor: StaffActor,
  input: unknown,
  options: AdminOptions = {},
): Promise<AdminDayQueues> {
  authorize(actor, "READ");
  const { date } = parse(DayQueuesQuerySchema, input);
  return read(options, async (tx) => {
    const queues = await tx.bookingQueue.findMany({
      orderBy: { sortOrder: "asc" },
    });
    const overrides = await tx.queueCapOverride.findMany({
      where: { date: dateCarrier(date) },
    });
    const rows = await tx.booking.findMany({
      where: { bookingDate: dateCarrier(date) },
      include: bookingInclude,
      orderBy: [{ queuePosition: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    const day: AdminQueueDay[] = [];
    for (const q of queues) {
      const own = rows.filter(
        (b) => b.snapshotVersion === "QUEUE_V3" && b.queueCode === q.code,
      );
      const open = own.filter((b) => b.status !== "CANCELLED"),
        cancelled = own.filter((b) => b.status === "CANCELLED");
      day.push({
        code: q.code,
        name: q.name,
        isActive: q.isActive,
        effectiveCap:
          overrides.find((o) => o.queueCode === q.code)?.dailyCap ?? q.dailyCap,
        committed: open.length,
        bookings: [...open, ...cancelled].map(toQueueBooking),
      });
    }
    return {
      date,
      closed: await closedDay(tx, date),
      queues: day,
      legacy: rows
        .filter((b) => b.snapshotVersion !== "QUEUE_V3")
        .map(toQueueBooking),
    };
  });
}

type Mode = AdminBookingSearchResult["searchMode"];
// ARCHITECTURE T-019 classifyAdminSearch, with the existing reference and PH phone rules.
export function classifySearch(q: string): { mode: Mode; value: string } {
  const t = q.trim();
  if (/^ZEUS-[A-Z0-9]{6}$/i.test(t))
    return { mode: "REFERENCE", value: t.toUpperCase() };
  if (/^\d{4}$/.test(t)) return { mode: "PHONE_SUFFIX", value: t };
  const phone = CustomerPhoneSchema.safeParse(t);
  if (phone.success) return { mode: "PHONE", value: phone.data };
  if (/^[\p{L}][\p{L}\p{M} .'-]{1,79}$/u.test(t))
    return { mode: "NAME", value: t };
  throw fieldError(
    "q",
    "Search by name, phone number, the last 4 digits or a reference.",
  );
}

interface ListInput {
  from?: string;
  to?: string;
  status?: string[];
  queueCode?: string;
  sort: "DAY_ASC" | "CREATED_AT_DESC";
  limit: number;
  cursor?: string;
}

async function page(
  options: AdminOptions,
  input: ListInput,
  tuple: unknown[],
  extra: Prisma.BookingWhereInput,
): Promise<AdminBookingList> {
  const hash = filterHash(tuple);
  const where: Prisma.BookingWhereInput[] = [extra];
  if (input.from || input.to)
    where.push({
      bookingDate: {
        ...(input.from ? { gte: dateCarrier(input.from) } : {}),
        ...(input.to ? { lte: dateCarrier(input.to) } : {}),
      },
    });
  if (input.status)
    where.push({
      status: { in: input.status as Prisma.EnumBookingStatusFilter["in"] },
    });
  if (input.queueCode) where.push({ queueCode: input.queueCode });
  if (input.cursor) {
    const k = decodeCursor(input.cursor, input.sort, hash);
    if (input.sort === "DAY_ASC") {
      const [d, c, id] = [
        dateCarrier(String(k[0])),
        new Date(String(k[1])),
        String(k[2]),
      ];
      where.push({
        OR: [
          { bookingDate: { gt: d } },
          { bookingDate: d, createdAt: { gt: c } },
          { bookingDate: d, createdAt: c, id: { gt: id } },
        ],
      });
    } else {
      const [c, id] = [new Date(String(k[0])), String(k[1])];
      where.push({
        OR: [{ createdAt: { lt: c } }, { createdAt: c, id: { lt: id } }],
      });
    }
  }
  const orderBy: Prisma.BookingOrderByWithRelationInput[] =
    input.sort === "DAY_ASC"
      ? [{ bookingDate: "asc" }, { createdAt: "asc" }, { id: "asc" }]
      : [{ createdAt: "desc" }, { id: "desc" }];
  const rows = await read(options, (tx) =>
    tx.booking.findMany({
      where: { AND: where },
      orderBy,
      take: input.limit + 1,
      include: bookingInclude,
    }),
  );
  const items = rows.slice(0, input.limit);
  const last = items.at(-1);
  const nextCursor =
    rows.length > input.limit && last
      ? encodeCursor({
          s: input.sort,
          f: hash,
          k:
            input.sort === "DAY_ASC"
              ? [
                  isoDay(last.bookingDate),
                  last.createdAt.toISOString(),
                  last.id,
                ]
              : [last.createdAt.toISOString(), last.id],
        })
      : null;
  return { items: items.map(toQueueBooking), nextCursor };
}

// GET /api/admin/bookings: non-PII selectors only (T-019 S-03).
export async function listBookings(
  actor: StaffActor,
  input: unknown,
  options: AdminOptions = {},
): Promise<AdminBookingList> {
  authorize(actor, "READ");
  const v = parse(BookingListSchema, input);
  return page(
    options,
    v,
    [
      "LIST",
      v.from ?? null,
      v.to ?? null,
      v.status ? [...v.status].sort() : null,
      v.queueCode ?? null,
    ],
    {},
  );
}

// POST /api/admin/bookings/search: q only ever in a body. Never logged.
export async function searchBookings(
  actor: StaffActor,
  input: unknown,
  options: AdminOptions = {},
): Promise<AdminBookingSearchResult> {
  authorize(actor, "READ");
  const v = parse(BookingSearchSchema, input);
  const { mode, value } = classifySearch(v.q);
  const match: Prisma.BookingWhereInput =
    mode === "REFERENCE"
      ? { referenceCode: value }
      : mode === "PHONE"
        ? { customerPhone: value }
        : mode === "PHONE_SUFFIX"
          ? { customerPhone: { endsWith: value } }
          : { customerName: { contains: value, mode: "insensitive" } };
  const result = await page(
    options,
    v,
    [
      "SEARCH",
      v.from ?? null,
      v.to ?? null,
      v.status ? [...v.status].sort() : null,
      v.queueCode ?? null,
      mode,
      value,
    ],
    match,
  );
  return { ...result, searchMode: mode };
}

export async function getBookingDetail(
  actor: StaffActor,
  id: unknown,
  options: AdminOptions = {},
): Promise<AdminBookingDetail> {
  authorize(actor, "READ");
  const bookingId = parse(AdminIdSchema, id);
  const detail = await read(options, (tx) => loadDetail(tx, bookingId));
  if (!detail) throw new AdminServiceError("NOT_FOUND");
  return detail;
}

export const toBay = (b: {
  bayType: AdminBay["bayType"];
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  updatedAt: Date;
}): AdminBay => ({
  bayType: b.bayType,
  id: b.id,
  name: b.name,
  sortOrder: b.sortOrder,
  isActive: b.isActive,
  updatedAt: b.updatedAt.toISOString(),
});

export async function listBays(
  actor: StaffActor,
  options: AdminOptions = {},
): Promise<AdminBay[]> {
  authorize(actor, "READ");
  return (
    await read(options, (tx) =>
      tx.bay.findMany({ orderBy: [{ sortOrder: "asc" }, { nameKey: "asc" }] }),
    )
  ).map(toBay);
}

export async function getCaps(
  actor: StaffActor,
  input: unknown,
  options: AdminOptions = {},
): Promise<AdminQueueCaps[]> {
  authorize(actor, "READ");
  const { from, to } = parse(CapsQuerySchema, input);
  return read(options, async (tx) => {
    const queues = await tx.bookingQueue.findMany({
      orderBy: { sortOrder: "asc" },
    });
    const range = { gte: dateCarrier(from), lte: dateCarrier(to) };
    const overrides = await tx.queueCapOverride.findMany({
      where: { date: range },
      orderBy: { date: "asc" },
    });
    const counts = await tx.booking.groupBy({
      by: ["queueCode", "bookingDate"],
      _count: { _all: true },
      where: {
        bookingDate: range,
        snapshotVersion: "QUEUE_V3",
        status: { not: "CANCELLED" },
      },
      orderBy: [{ queueCode: "asc" }, { bookingDate: "asc" }],
    });
    return queues.map((q) => ({
      code: q.code,
      name: q.name,
      isActive: q.isActive,
      dailyCap: q.dailyCap,
      revision: q.revision,
      overrides: overrides
        .filter((o) => o.queueCode === q.code)
        .map((o) => ({
          date: isoDay(o.date),
          dailyCap: o.dailyCap,
          revision: o.revision,
        })),
      committed: counts
        .filter((c) => c.queueCode === q.code)
        .map((c) => ({ date: isoDay(c.bookingDate), count: c._count._all })),
    }));
  });
}

export { committed };
