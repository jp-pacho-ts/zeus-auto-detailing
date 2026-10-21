import { BookingQuoteSchema, CatalogSelectionSchema } from "@/types/catalog-contracts";
import { z } from "zod";

export const VehicleCategoryCodeSchema = z.enum([
  "SEDAN", "SUV_CROSSOVER", "PICKUP_VAN", "MOTORCYCLE_SPECIALTY",
]);
export const BookingStatusSchema = z.enum([
  "PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED",
]);
export const UUIDSchema = z.string().uuid();
export const LocalTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const LocalDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T00:00:00.000Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Use a real calendar date in YYYY-MM-DD format");
export const LocalMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const CustomerPhoneSchema = z.string().trim().max(32)
  .regex(/^[+0-9 ()-]+$/, "Use a Philippine mobile number")
  .transform((s) => s.replace(/[ ()-]/g, ""))
  .transform((s) => /^09\d{9}$/.test(s)
    ? "+63" + s.slice(1)
    : /^639\d{9}$/.test(s) ? "+" + s : s)
  .pipe(z.string().regex(/^\+639\d{9}$/,
    "Use 09XXXXXXXXX or +639XXXXXXXXX"));

const hasControl = (s: string, multiline = false) => Array.from(s).some((c) => {
  const code = c.codePointAt(0)!;
  return (code < 32 || (code >= 127 && code <= 159)) && !(multiline && (code === 9 || code === 10));
});
const SingleLine = () => z.string().refine((s) => !hasControl(s), "Use a single line without control characters").trim();
const OptionalText = (max: number) => SingleLine().max(max).optional()
  .transform((s) => s === "" ? undefined : s);
const OptionalEmail = SingleLine().max(254).optional()
  .transform((s) => s === "" ? undefined : s)
  .pipe(z.string().email().optional());

export const CreateBookingSchema = z.object({
  idempotencyKey: z.string().uuid().refine(
    (s) => s[14] === "4", "Use a random UUID v4 retry key"),
  vehicleCategoryId: UUIDSchema,
  serviceId: UUIDSchema,
  bookingDate: LocalDateSchema,
  startTime: LocalTimeSchema,
  customerName: SingleLine().min(2).max(100),
  customerPhone: CustomerPhoneSchema,
  customerEmail: OptionalEmail,
  vehicleModel: SingleLine().min(2).max(100),
  vehiclePlate: OptionalText(20).transform((s) => s?.toUpperCase()),
  specialRequests: z.string().refine((s) => !hasControl(s, true), "Notes may contain newlines and tabs only").trim().max(1000).optional().transform((s) => s === "" ? undefined : s),
}).strict();
export const GetAvailableSlotsSchema = z.object({
  date: LocalDateSchema,
  vehicleCategoryId: UUIDSchema,
  serviceId: UUIDSchema,
}).strict();
export const GetCalendarMonthScheduleSchema = z.object({
  month: LocalMonthSchema,
}).strict();
export const UpdateSlotCapacitySchema = z.object({
  date: LocalDateSchema,
  slotId: UUIDSchema,
  maxVehicleCapacity: z.number().int().min(0).max(20),
  expectedVersion: z.number().int().min(0),
}).strict();
export const UpdateBookingStatusSchema = z.object({
  bookingId: UUIDSchema,
  status: BookingStatusSchema,
}).strict();

// P1-03 queue contracts. The archived slot schemas above remain for historical replay only.
export const TurnstileTokenSchema = z.string().min(1).max(2048).regex(/^[\x21-\x7E]+$/);
export const CreateDayBookingSchema = CreateBookingSchema.omit({ serviceId: true, startTime: true, vehicleCategoryId: true }).extend({
 contractVersion: z.literal(4),
 idempotencyKey: z.string().uuid().refine(s => s[14] === "4").transform(s => s.toLowerCase()),
 vehicleCategoryId: CatalogSelectionSchema.shape.vehicleCategoryId,
 lines: CatalogSelectionSchema.shape.lines,
 acceptedQuote: BookingQuoteSchema,
 turnstileToken: TurnstileTokenSchema,
}).strict().superRefine((r, ctx) => {
 if (r.vehicleCategoryId !== r.acceptedQuote.vehicleCategoryId || r.lines.length !== r.acceptedQuote.lines.length || r.lines.some((l, i) => l.serviceId !== r.acceptedQuote.lines[i].serviceId || l.quantity !== r.acceptedQuote.lines[i].quantity)) ctx.addIssue({ code: "custom", path: ["acceptedQuote"], message: "Selection must match the accepted quote" });
});
export const DayAvailabilitySchema = CatalogSelectionSchema.extend({ fromDate: LocalDateSchema, days: z.number().int().min(1).max(31).default(14) }).strict();

// P1-04: private authority is never a reference or phone number.
const PrivateKeySchema = z.string().uuid().refine(s => s[14] === "4").transform(s => s.toLowerCase());
const ManagedBookingId = UUIDSchema.transform(s => s.toLowerCase());
export const CancelManagedBookingSchema = z.object({bookingId:ManagedBookingId,idempotencyKey:PrivateKeySchema,expectedRevision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)}).strict();
export const RescheduleManagedBookingSchema = CancelManagedBookingSchema.extend({bookingDate:LocalDateSchema}).strict();
export const RecoverBookingOperationSchema = z.discriminatedUnion("operationKind",[
 z.object({operationKind:z.literal("CREATE"),idempotencyKey:PrivateKeySchema,bookingId:z.null()}).strict(),
 z.object({operationKind:z.enum(["CANCEL","RESCHEDULE"]),idempotencyKey:PrivateKeySchema,bookingId:ManagedBookingId}).strict(),
]);
export const ExchangeManagementAccessSchema = z.object({accessToken:z.string().min(1).max(4096)}).strict();
export const ManagedDayAvailabilitySchema = z.object({bookingId:ManagedBookingId,fromDate:LocalDateSchema,days:z.number().int().min(1).max(31).default(14)}).strict();
