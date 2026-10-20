// Zod schemas for the admin queue and booking API (P1-07, PM decision D1). Every schema is
// strict: unknown fields are refused. UUIDs are lowercased; money is integer centavos.
import { z } from "zod";
import { QueueCodeSchema } from "@/types/catalog-contracts";
import { LocalDateSchema } from "./validation";

const Id = z
  .string()
  .uuid()
  .transform((s) => s.toLowerCase());
const Revision = z.number().int().min(1);
const Reason = z.string().trim().min(1).max(500);
const Money = z.number().int().min(0).max(100_000_000);
const Cap = z.number().int().min(0).max(500);
const Instant = z.string().datetime({ precision: 3, offset: false });
const Status = z.enum([
  "PENDING",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
]);

export const AdminIdSchema = Id;
export const AdminQueueCodeSchema = QueueCodeSchema;
export const AdminDaySchema = LocalDateSchema;

export const DayQueuesQuerySchema = z
  .object({ date: LocalDateSchema })
  .strict();

const ListFields = {
  from: LocalDateSchema.optional(),
  to: LocalDateSchema.optional(),
  status: z.array(Status).min(1).max(5).optional(),
  queueCode: QueueCodeSchema.optional(),
  sort: z.enum(["DAY_ASC", "CREATED_AT_DESC"]).default("DAY_ASC"),
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(512).optional(),
};
const rangeOk = (v: { from?: string; to?: string }) =>
  !v.from ||
  !v.to ||
  (v.from <= v.to && Date.parse(v.to) - Date.parse(v.from) <= 366 * 86_400_000);
// GET /api/admin/bookings: non-PII selectors only; q never travels in a URL (T-019 S-03).
export const BookingListSchema = z
  .object(ListFields)
  .strict()
  .refine(rangeOk, {
    path: ["to"],
    message: "Use a range of at most 366 days",
  });
export const BookingSearchSchema = z
  .object({ ...ListFields, q: z.string().trim().min(1).max(80) })
  .strict()
  .refine(rangeOk, {
    path: ["to"],
    message: "Use a range of at most 366 days",
  });
export const CapsQuerySchema = z
  .object({ from: LocalDateSchema, to: LocalDateSchema })
  .strict()
  .refine(
    (v) =>
      v.from <= v.to &&
      Date.parse(v.to) - Date.parse(v.from) <= 93 * 86_400_000,
    { path: ["to"], message: "Use a range of at most 93 days" },
  );

export const BookingStatusWriteSchema = z
  .object({
    expectedRevision: Revision,
    status: z.enum(["CONFIRMED", "IN_PROGRESS", "COMPLETED", "PENDING"]), // PENDING = reinstate (D5)
    reason: Reason.optional(),
  })
  .strict()
  .refine((v) => v.status !== "PENDING" || v.reason !== undefined, {
    path: ["reason"],
    message: "Give a reason to reinstate",
  });
export const DeclineSchema = z
  .object({ expectedRevision: Revision, reason: Reason })
  .strict();
export const MoveSchema = z
  .object({
    expectedRevision: Revision,
    toDate: LocalDateSchema,
    toQueueCode: QueueCodeSchema,
  })
  .strict();
export const ReorderSchema = z
  .object({
    bookings: z
      .array(z.object({ id: Id, expectedRevision: Revision }).strict())
      .min(1)
      .max(200)
      .refine(
        (list) => new Set(list.map((b) => b.id)).size === list.length,
        "Each booking once",
      ),
  })
  .strict();
export const AddLineSchema = z
  .object({
    expectedRevision: Revision,
    serviceId: Id,
    quantity: z.number().int().min(1).max(20),
  })
  .strict();
export const RemoveLineSchema = z
  .object({ expectedRevision: Revision, reason: Reason.optional() })
  .strict();
export const LineStatusSchema = z
  .object({
    expectedRevision: Revision,
    workStatus: z.enum(["WAITING", "IN_PROGRESS", "DONE"]),
  })
  .strict();
export const LinePriceSchema = z
  .object({ expectedRevision: Revision, priceCentavos: Money, reason: Reason })
  .strict();
export const BayAssignSchema = z
  .object({
    expectedRevision: Revision,
    date: LocalDateSchema,
    bayId: Id.nullable(),
  })
  .strict();
export const WorkerAssignSchema = z
  .object({ expectedRevision: Revision })
  .strict();
export const BayTypeSchema = z.enum(["WASH", "DETAILING", "PAINT"]);
const BayName = z.string().trim().min(1).max(40);
export const BayCreateSchema = z
  .object({
    bayType: BayTypeSchema,
    name: BayName,
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .strict();
export const BayUpdateSchema = z
  .object({
    expectedUpdatedAt: Instant,
    bayType: BayTypeSchema.optional(),
    name: BayName.optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.bayType !== undefined ||
      v.name !== undefined ||
      v.sortOrder !== undefined ||
      v.isActive !== undefined,
    "Change at least one field",
  );
export const DefaultCapSchema = z
  .object({ expectedRevision: Revision, dailyCap: Cap.nullable() })
  .strict();
export const CapOverrideSchema = z
  .object({ expectedRevision: Revision.nullable(), dailyCap: Cap })
  .strict();
export const CapOverrideDeleteSchema = z
  .object({ expectedRevision: Revision })
  .strict();
export const NotifySchema = z.object({ expectedRevision: Revision }).strict();
// Malformed numbers are not a 400: they get the fixed empty result (PM decision D8).
export const CustomerHistorySchema = z
  .object({ phone: z.string().max(64) })
  .strict();
