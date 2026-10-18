import "server-only";
import type { AdminCustomerHistory } from "@/types/admin-contracts";
import { CustomerHistorySchema } from "@/lib/admin-validation";
import { CustomerPhoneSchema } from "@/lib/validation";
import { withStaffPermit } from "@/server/auth/db-admission";
import { createWindowCounter } from "@/server/auth/rate-limit";
import { authorize, isoDay, parse, type AdminOptions, type StaffActor } from "./context";
import { AdminServiceError } from "./errors";
import { historyDigest, historyKeyRing } from "./history-key-ring";
import { adminEvent } from "./log";
import { toQueueBooking } from "./views";

// W16: one customer's bookings by phone, for ADMIN only (ADR-005 §16a). No customer account is
// created. The phone arrives only in a POST body and is never logged, stored or put in a URL;
// the audit row keeps its keyed HMAC digest and the result count. Malformed numbers get the
// same empty result as unknown ones, and are audited too (D8).
const perMinute = createWindowCounter(10, 60_000);
const perDay = createWindowCounter(100, 86_400_000);
const LIMIT = 50;
const EMPTY: AdminCustomerHistory = { bookings: [], truncated: false };

export async function lookupCustomerHistory(actor: StaffActor, input: unknown, options: AdminOptions = {}): Promise<AdminCustomerHistory> {
  authorize(actor, "HISTORY_LOOKUP");
  const { phone } = parse(CustomerHistorySchema, input);
  const ring = options.ring === undefined ? historyKeyRing() : options.ring;
  if (!ring) {
    adminEvent("admin.history.unavailable", { actorStaffId: actor.staffId });
    throw new AdminServiceError("RETRYABLE_ERROR"); // fail closed until the key ring is configured (D7)
  }
  if (perMinute.blocked(actor.sessionId) || perDay.blocked(actor.sessionId)) {
    throw new AdminServiceError("RATE_LIMITED", undefined, { retryAfterSeconds: 60 });
  }
  perMinute.record(actor.sessionId);
  perDay.record(actor.sessionId);
  const normalized = CustomerPhoneSchema.safeParse(phone);
  const digest = historyDigest(ring, normalized.success ? normalized.data : null, phone);
  const result = await withStaffPermit("STAFF_MUTATION", (permit) => permit.write(async (tx) => {
    const rows = normalized.success
      ? await tx.booking.findMany({ where: { customerPhone: normalized.data }, orderBy: [{ bookingDate: "desc" }, { createdAt: "desc" }], take: LIMIT + 1,
        include: { lineItems: { orderBy: { order: "asc" } }, bayAssignments: { include: { bay: { select: { id: true, name: true } } } }, queue: { select: { name: true } } } })
      : [];
    await tx.bookingAuditEvent.create({ data: { action: "HISTORY_LOOKUP", actorStaffId: actor.staffId, phoneDigest: digest, resultCount: Math.min(rows.length, LIMIT) } });
    return rows;
  }), { db: options.db });
  adminEvent("admin.history.lookup", { actorStaffId: actor.staffId, resultCount: Math.min(result.length, LIMIT) });
  if (result.length === 0) return EMPTY;
  return {
    bookings: result.slice(0, LIMIT).map((b) => {
      const view = toQueueBooking(b);
      return { id: b.id, referenceCode: b.referenceCode, bookingDate: isoDay(b.bookingDate), queueName: b.queue?.name ?? "Legacy", status: b.status,
        customerName: b.customerName, services: view.lines.filter((l) => !l.removed).map((l) => l.name).concat(view.lines.length ? [] : [b.serviceNameSnapshot]), totals: view.totals };
    }),
    truncated: result.length > LIMIT,
  };
}
