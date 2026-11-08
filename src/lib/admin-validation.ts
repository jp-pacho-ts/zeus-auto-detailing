// Zod schemas for the admin queue and booking API (P1-07, PM decision D1). Every schema is
// strict: unknown fields are refused. UUIDs are lowercased; money is integer centavos.
import { z } from "zod";
import { QueueCodeSchema } from "@/types/catalog-contracts";
import { percentToBasisPoints } from "./commission";
import { MAX_STOCK, pesosToCentavos } from "./supplies";
import { expensePesosToCentavos, isReservedCategoryName } from "./expenses";
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
// P1-18: ADMIN decides on a deposit; PROOF_SENT comes only from a customer upload.
export const DepositStatusSchema = z
  .object({ expectedRevision: Revision, status: z.enum(["RECEIVED", "REJECTED"]), reason: Reason.optional() })
  .strict();
// P1-29: ADMIN deletes a booking by typing its reference code; the revision stops a stale screen.
export const DeleteBookingSchema = z
  .object({ expectedRevision: Revision, reference: z.string().min(1).max(60) })
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
    bayType: BayTypeSchema.optional(), // legacy placeholder since P1-62: the container groups bays now
    containerId: Id.optional(), // none = the starting container of the legacy type (the database fallback)
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
// P1-34: finish a car (every service done, booking completed); the revision stops a stale card.
export const FinishBookingSchema = z.object({ expectedRevision: Revision }).strict();
// Malformed numbers are not a 400: they get the fixed empty result (PM decision D8).
export const CustomerHistorySchema = z
  .object({ phone: z.string().max(64) })
  .strict();

// P1-37 Team & commissions. Every schema is strict (a stray role, id or amount in a body is refused). A percentage is a
// decimal string with at most two decimals and is converted to basis points exactly (src/lib/commission.ts), never
// through a float. The database functions repeat every check.
const Percent = z
  .string()
  .trim()
  .refine((s) => percentToBasisPoints(s) !== null, "Enter a percentage from 0 to 100 with at most 2 decimals.");
const PersonName = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(80, "Use 80 characters or fewer.")
  .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), "Use letters, numbers and normal punctuation.");
const PersonPhone = z
  .string()
  .trim()
  .max(30, "Use 30 characters or fewer.")
  .regex(/^[0-9+() -]*$/, "Use digits, spaces, + ( ) and - only.");
const PersonEmail = z.string().trim().toLowerCase().max(120).email("Enter a valid email.");
// P1-64: the details the admin keeps about a person. Every key is sent every time ("set these values"); null or blank clears that detail.
const ProfileLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), "Use letters, numbers and normal punctuation.")
    .transform((s) => s || null)
    .nullable();
const ProfileText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .refine((s) => !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(s), "Use letters, numbers and normal punctuation.")
    .transform((s) => s || null)
    .nullable();
export const StaffProfileSchema = z
  .object({
    nickname: ProfileLine(40),
    position: ProfileLine(40),
    contactEmail: z.union([PersonEmail, z.literal("")]).transform((s) => s || null).nullable(),
    address: ProfileText(300),
    birthDate: LocalDateSchema.nullable(),
    hiredOn: LocalDateSchema.nullable(),
    emergencyName: ProfileLine(80),
    emergencyPhone: PersonPhone.transform((s) => s || null).nullable(),
    notes: ProfileText(1000),
  })
  .strict();
export const TeamCreateSchema = z
  .object({
    // P1-64: made once per form by the browser, so a retry after a lost response cannot add a second person.
    id: Id.optional(),
    name: PersonName,
    phone: PersonPhone.optional(),
    email: z.union([PersonEmail, z.literal("")]).optional(),
    ratePercent: Percent.nullable().optional(),
    profile: StaffProfileSchema.optional(),
  })
  .strict();
// An absent field is left alone; ratePercent null clears the personal rate (use the default).
export const TeamUpdateSchema = z
  .object({
    expectedRevision: Revision,
    name: PersonName.optional(),
    phone: PersonPhone.optional(),
    email: PersonEmail.optional(),
    ratePercent: Percent.nullable().optional(),
    profile: StaffProfileSchema.optional(),
  })
  .strict();
export const TeamRemoveSchema = z.object({ expectedRevision: Revision }).strict();
export const CommissionDefaultSchema = z
  .object({ expectedRevision: Revision, ratePercent: Percent })
  .strict();
export const CommissionListSchema = z
  .object({
    from: LocalDateSchema,
    to: LocalDateSchema,
    staffId: Id.optional(),
    status: z.enum(["ALL", "PAID", "UNPAID"]).default("ALL"),
  })
  .strict()
  .refine((v) => v.to >= v.from, { message: "The end day can't be before the start day.", path: ["to"] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 365, { message: "Choose a range of one year or less.", path: ["to"] });
// A signed whole-centavo correction to one person's commission (never zero, at most 10 billion pesos), with a reason.
export const CommissionAdjustSchema = z
  .object({
    id: Id, // made by the browser once per form, so a retry after a lost response cannot record the adjustment twice
    entryId: Id,
    amountCentavos: z.number().int("Use whole centavos.").refine((n) => n !== 0, "The adjustment can't be zero.").refine((n) => Math.abs(n) <= 1_000_000_000_000, "That amount is too large."),
    reason: z.string().trim().min(1, "Give a reason.").max(200, "Use 200 characters or fewer."),
  })
  .strict();
export const CommissionPaidSchema = z
  .object({ ids: z.array(Id).min(1).max(200), paid: z.boolean() })
  .strict();

// P1-38 Supplies & Inventory. Money is typed in pesos and becomes integer centavos here; the browser makes `id` once per form content
// so a retry after a lost response cannot record the same thing twice.
const SupplyName = z.string().trim().min(1, "Enter a name.").max(80, "Use 80 characters or fewer.");
const SupplyCategory = z.string().trim().min(1, "Enter a category or leave it out.").max(60, "Use 60 characters or fewer.");
const SupplyUnit = z.string().trim().min(1, "Enter a unit, like bottle or pcs.").max(20, "Use 20 characters or fewer.");
const StockInt = z.number().int("Enter a whole number.").min(0, "Enter zero or more.").max(MAX_STOCK, "That is more than the largest stock we can hold.");
const CostPesos = z.string().refine((v) => pesosToCentavos(v) !== null, "Enter pesos with at most two decimals, up to 1,000,000.00.");
export const SupplyCreateSchema = z
  .object({ id: Id, name: SupplyName, category: SupplyCategory.optional(), unit: SupplyUnit, reorderLevel: StockInt, costPesos: CostPesos, startingStock: StockInt.optional() })
  .strict()
  .transform((v) => ({ ...v, costCentavos: pesosToCentavos(v.costPesos) as number }));
// An absent field is left alone; category null clears it.
export const SupplyUpdateSchema = z
  .object({ expectedRevision: Revision, name: SupplyName.optional(), category: SupplyCategory.nullable().optional(), unit: SupplyUnit.optional(), reorderLevel: StockInt.optional(), costPesos: CostPesos.optional() })
  .strict()
  .refine((v) => Object.keys(v).some((k) => k !== "expectedRevision"), "Change at least one field.")
  .transform((v) => ({ ...v, costCentavos: v.costPesos === undefined ? undefined : (pesosToCentavos(v.costPesos) as number) }));
// Stock goes in (RECEIVE) or out (USE). There is no other way to take stock away (LE 2026-11-06); a wrong USE is fixed with a RECEIVE and a note.
export const SupplyStockSchema = z
  .object({
    id: Id,
    expectedRevision: Revision,
    kind: z.enum(["RECEIVE", "USE"]),
    quantity: z.number().int("Enter a whole number.").min(1, "Enter at least 1.").max(MAX_STOCK, "That is more than the largest stock we can hold."),
    unitCostPesos: CostPesos.optional(),
    note: z.string().trim().min(1, "Give a note or leave it out.").max(200, "Use 200 characters or fewer.").optional(),
  })
  .strict()
  .refine((v) => v.unitCostPesos === undefined || v.kind === "RECEIVE", { message: "A cost belongs to stock coming in.", path: ["unitCostPesos"] })
  .transform((v) => ({ ...v, unitCostCentavos: v.unitCostPesos === undefined ? undefined : (pesosToCentavos(v.unitCostPesos) as number) }));
export const SupplyRemoveSchema = z.object({ expectedRevision: Revision }).strict();
export const SupplyListSchema = z.object({ includeArchived: z.enum(["true", "false"]).default("false").transform((v) => v === "true") }).strict();
// P1-39 Expenses. Amounts are typed in pesos and become integer centavos here. Required: date, category, amount. The browser makes `id` once per form
// content, so a retry after a lost response cannot record the same expense twice. An edit is "set these values": a payee or note left out is cleared.
const ExpensePesos = z.string().refine((v) => expensePesosToCentavos(v) !== null, "Enter an amount in pesos, more than zero, with at most two decimals, up to 100,000,000.00.");
const ExpensePayee = z.string().trim().min(1, "Enter who was paid or leave it out.").max(80, "Use 80 characters or fewer.");
const ExpenseNote = z.string().trim().min(1, "Enter a note or leave it out.").max(200, "Use 200 characters or fewer.");
const ExpenseFields = { date: LocalDateSchema, categoryId: Id, amountPesos: ExpensePesos, payee: ExpensePayee.optional(), note: ExpenseNote.optional() };
function withCentavos<T extends { amountPesos: string }>(v: T) { return { ...v, amountCentavos: expensePesosToCentavos(v.amountPesos) as number }; }
export const ExpenseCreateSchema = z.object({ id: Id, ...ExpenseFields }).strict().transform(withCentavos);
export const ExpenseUpdateSchema = z.object({ expectedRevision: Revision, ...ExpenseFields }).strict().transform(withCentavos);
export const ExpenseVoidSchema = z.object({ expectedRevision: Revision, reason: z.string().trim().min(1, "Give a reason or leave it out.").max(200, "Use 200 characters or fewer.").optional() }).strict();
export const ExpenseRestoreSchema = z.object({ expectedRevision: Revision }).strict();
export const ExpenseMonthSchema = z
  .object({
    month: z.string().regex(/^20[0-9]{2}-(0[1-9]|1[0-2])$/, "Use a month like 2026-11."),
    categoryId: Id.optional(),
    includeRemoved: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    cursor: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{1,18}$/).refine((c) => LocalDateSchema.safeParse(c.split("_")[0]).success).optional(),
  })
  .strict();
export const ExpenseTotalsSchema = z.object({ from: LocalDateSchema, to: LocalDateSchema }).strict().refine((v) => v.from <= v.to, "The first day must not be after the last day.");
const ExpenseCategoryName = z.string().trim().min(1, "Enter a name.").max(40, "Use 40 characters or fewer.").refine((v) => !isReservedCategoryName(v), "That name is used by the automatic lines. Choose another.");
export const ExpenseCategoryCreateSchema = z.object({ id: Id, name: ExpenseCategoryName }).strict();
export const ExpenseCategoryUpdateSchema = z
  .object({ expectedRevision: Revision, name: ExpenseCategoryName.optional(), isActive: z.boolean().optional() })
  .strict()
  .refine((v) => v.name !== undefined || v.isActive !== undefined, "Change the name or whether it is shown.");
export const SupplyMovementsSchema = z.object({ cursor: z.string().regex(/^[0-9]{1,18}$/).optional() }).strict();
// P1-62 A1 bay containers. The browser makes the id of a new container (a retry after a lost response adds it once).
const ContainerName = z.string().trim().min(1, "Enter a name.").max(40, "Use 40 characters or fewer.");
const UsualQueues = z.array(AdminQueueCodeSchema).max(10).refine((l) => new Set(l).size === l.length, "Each service can be listed once.");
export const ContainerCreateSchema = z.object({ id: Id, name: ContainerName, usualQueues: UsualQueues.optional() }).strict();
export const ContainerUpdateSchema = z
  .object({ expectedUpdatedAt: Instant, name: ContainerName.optional(), usualQueues: UsualQueues.optional() })
  .strict()
  .refine((v) => v.name !== undefined || v.usualQueues !== undefined, "Change the name or the label.");
export const ContainerRemoveSchema = z.object({ expectedUpdatedAt: Instant }).strict();
export const BayMoveSchema = z.object({ expectedUpdatedAt: Instant, containerId: Id }).strict();
// P1-40: at most a year, the same limit as CommissionListSchema because the range is passed on to it.
export const AnalyticsQuerySchema = z
  .object({ from: LocalDateSchema, to: LocalDateSchema })
  .strict()
  .refine((v) => v.to >= v.from, { message: "The end day can't be before the start day.", path: ["to"] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 365, { message: "Choose a range of one year or less.", path: ["to"] });

// P1-42: every value each time, so a retry is the same request. An empty message means none.
export const ShopSettingsUpdateSchema = z
  .object({
    expectedRevision: Revision,
    maintenance: z.boolean(),
    bookingPaused: z.boolean(),
    maintenanceMessage: z.string().trim().max(200, "Keep the message to 200 characters.").regex(/^\P{Cc}*$/u, "The message can only be one line of plain text.").nullable(),
  })
  .strict()
  .transform((v) => ({ ...v, maintenanceMessage: v.maintenanceMessage === "" ? null : v.maintenanceMessage }));
