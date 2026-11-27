# Admin "New booking" modal: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans. AGENTS.md forbids
> subagents, so this runs natively in one session. Steps use checkbox (`- [ ]`) syntax.

**Goal:** the admin books walk-ins and phone customers from a modal on the Bookings page,
through the same booking engine as `/book`, without that page's anti-stranger checks.

**Architecture:** `createDayBooking` gets an internal admin mode. A logged-in ADMIN skips
Turnstile, the per-IP admission and budgets, the shop daily budget and the online pause. It
keeps every other rule. A new admin service and `POST /api/admin/bookings` wrap it. The modal
reuses the catalog, availability and day-picker pieces the wizard already uses.

**Tech stack:** Next.js 16 App Router, React 19, Prisma 6, Zod 4, node:test.

**Spec:** `docs/superpowers/specs/2026-11-27-admin-add-booking-modal-design.md`

## Global constraints

- Booking writes keep `lockBookingShop` then `lockBookingDates` inside one transaction.
- Zod at the boundary. Authorization inside the service, failing closed. Server modules import `server-only`.
- No schema or migration change. Money in integer centavos. Asia/Manila dates.
- ADMIN role only. STAFF (detailer) is refused by the service.
- Bookings are created PENDING. Full and closed days are refused. The customer email is unchanged.
- The public `createDayBooking` behaves exactly as before, and every existing test passes unchanged.

## Review focus

1. **Legacy ledger rows with a NULL `clientHash` must still count** toward the public budgets
   once admin rows are excluded. Filter in JS (`r.clientHash !== ADMIN_CLIENT_HASH`), never
   with SQL `<>`/`NOT LIKE`, which drops NULLs. Pinned in Task 2, test 2.
2. **Admin edits after a refusal (for example a full day) and saves again.** The same
   idempotency key with a different body gives IDEMPOTENCY_CONFLICT. The modal makes a new key
   after any definite refusal, and reuses it only for RETRYABLE or network failures. Pinned in
   Task 4, step 1.
3. **A booking replays (`created: false`).** The admin gets the same booking back, with no
   duplicate and no second email. Pinned in Task 2, test 4.
4. **The admin body carries `turnstileToken`, or the public body omits it.** Both strict
   schemas refuse. Pinned in Task 1.
5. **The modal opens with online booking paused.** Days still show, because
   `onlineBookingStatus` is not passed to `DayPicker`. Pinned in Task 4, step 1 (a pure helper test).

---

### Task 1: Admin request schema and client request builder

**Files:**
- Modify: `src/lib/validation.ts:96-108`
- Modify: `src/components/booking/day-booking.ts` (`createDayRequest`)
- Modify: `src/types/contracts.ts:215`
- Test: `src/components/booking/day-booking.test.ts` (holds the `createDayRequest` tests)

**Interfaces:**
- Produces: `CreateAdminDayBookingSchema` (zod, strict, has no `turnstileToken`),
  `type CreateAdminDayBookingRequest`, and
  `createAdminDayRequest({ form, quote, bookingDate, idempotencyKey }) -> { ok: true; data: CreateAdminDayBookingRequest } | { ok: false; fieldErrors }`.

- [ ] Test: `createAdminDayRequest` with a valid form gives `ok`, with no `turnstileToken` key. `CreateAdminDayBookingSchema` refuses the same body plus `turnstileToken`. `CreateDayBookingSchema` still refuses a body with no `turnstileToken`. An empty first name gives `fieldErrors.customerFirstName`.
- [ ] Run `node --require ./src/server/__tests__/register.cjs --test src/components/booking/day-booking.test.ts`. Expect FAIL: the export is missing.
- [ ] Implement it. Move the body of `CreateDayBookingSchema` (without `turnstileToken`) into a `dayBookingFields` object, and its refinement into `refineDayBooking`. Build both schemas as `.extend(...)`, `.strict()`, `.superRefine(refineDayBooking)` and `.transform(withComposedName)`. In `day-booking.ts`, extract the shared field mapping and error mapping. `createAdminDayRequest` adds no payment tag.
- [ ] Run again. Expect PASS. Run typecheck.
- [ ] Commit `feat(booking): admin day-booking request schema without a challenge token`.

### Task 2: Admin mode in the booking engine

**Files:**
- Modify: `src/server/bookings-create.ts`
- Test (new): `src/server/admin/create-booking.integration.test.ts`. The fixture copies the
  pattern from `bookings-create.integration.test.ts:73-110`.

**Interfaces:**
- Produces: `createAdminDayBooking(input: unknown, options?: Omit<CreateDayBookingOptions, "headers" | "turnstileEndpoint">): Promise<BookingCommit>`
  and `ADMIN_CLIENT_HASH = sha256("zeus-admin-walk-in")`. This is a fixed 64-hex marker,
  because the `operation_shape` CHECK refuses any other `clientHash` shape.

Admin mode, in one shared function that `createDayBooking` and `createAdminDayBooking` both call:
- **Skips:** `checkBookingOrigin`, `trustedClientKey` and `enterBooking`, with
  `clientHash = ADMIN_CLIENT_HASH`. Also the preflight budget and pause, `verifyTurnstile`,
  the in-transaction pause and the per-client budget, the Turnstile reuse check, `rejectionBudget`,
  the shop `dailyBudget`, and every `bookingTurnstileUse` insert.
- **Phone rule wording:** "This phone number already has 2 active bookings."
- **`counts()`:** drops rows whose `clientHash` equals `ADMIN_CLIENT_HASH`, filtered in JS.

- [ ] Write the tests. Each uses its own fixture suffix.
  1. `admin books while paused (env and database) with no token: PENDING, queue position, one email, no turnstile row`.
  2. `admin bookings skip per-client and shop budgets and do not use them up`: config `BOOKING_SHOP_DAILY_BUDGET` is 2. Three admin bookings are OK. Then two public bookings are OK, and the third public booking gives `ONLINE_BOOKING_UNAVAILABLE`/paused. Also insert a legacy committed op with `clientHash: null` and assert it still counts.
  3. `admin is refused on full and closed days and by the phone rule`: `FULLY_BOOKED`, `DAY_CLOSED`, and `BOOKING_LIMIT_REACHED` with the admin message.
  4. `admin replay returns the same booking without a second effect or email`.
  5. `public create is unchanged`: a body with no token is still refused for the public path.
- [ ] Create a fresh `zeus_t007_*` DB. Run `node --require ./src/server/__tests__/register.cjs --test src/server/admin/create-booking.integration.test.ts`. Expect FAIL: the export is missing.
- [ ] Implement it.
- [ ] Run the new suite and `src/server/bookings-create.integration.test.ts`, each on its own fresh DB. Expect PASS.
- [ ] Commit `feat(booking): admin mode in the day-booking engine`.

### Task 3: Permission, admin service and route

**Files:**
- Modify: `src/server/admin/roles.ts` (add `"BOOKING_CREATE"` to `ADMIN_OPS` only)
- Modify: `src/server/admin/admin.test.ts:55` (classify `BOOKING_CREATE` as admin-only)
- Create: `src/server/admin/create-booking.ts`
- Modify: `src/server/admin/index.ts` (export `createBooking`)
- Modify: `src/app/api/admin/bookings/route.ts` (add `POST`)
- Modify: `src/server/admin/routes.test.ts` (add `["POST", "/api/admin/bookings", …]`)
- Test: extend `create-booking.integration.test.ts`

**Interfaces:**
- Consumes: `createAdminDayBooking`.
- Produces: `createBooking(actor: StaffActor, input: unknown, options?: AdminOptions): Promise<{ booking: DayBookingView; replayed: boolean }>`.
  It throws `AdminServiceError`. Error mapping:

| Lifecycle error | Admin error | Field error |
|---|---|---|
| `VALIDATION_ERROR` | `VALIDATION_ERROR` | the same fields |
| `FULLY_BOOKED`, `DAY_CLOSED` | `SCHEDULE_CONFLICT` | `bookingDate` |
| `BOOKING_LIMIT_REACHED` | `NOT_ALLOWED` | `customerPhone` |
| `IDEMPOTENCY_CONFLICT` | `IDEMPOTENCY_CONFLICT` | |
| `CATALOG_UPDATED`, `QUOTE_EXPIRED`, `QUOTE_REQUIRED`, `SERVICE_NOT_OFFERED` | `CATALOG_UPDATED` | |
| `RETRYABLE_ERROR`, `RATE_LIMITED` | `RETRYABLE_ERROR` | |
| anything else | `NOT_ALLOWED` | |

  For each mapped error, the message comes from the lifecycle error. On success it logs
  `adminEvent("admin.booking.created", { bookingId, actorStaffId })`.

- [ ] Tests: in `admin.test.ts`, `BOOKING_CREATE` is admin-only. In `routes.test.ts`, the new POST is covered (cross-origin refused, anonymous gets 401). In the integration suite, STAFF gets `FORBIDDEN` with nothing written; ADMIN succeeds and the result has no `managementAccess`; a full day maps to `SCHEDULE_CONFLICT` with `fieldErrors.bookingDate`.
- [ ] Run them. Expect FAIL.
- [ ] Implement it.
- [ ] Run them. Expect PASS.
- [ ] Commit `feat(admin): POST /api/admin/bookings creates a booking for walk-ins`.

### Task 4: New booking dialog

**Files:**
- Modify: `src/components/ui/dialog.tsx` (an optional `className` on the panel, merged with `cn`, with the default `max-w-lg` kept)
- Create: `src/components/admin/bookings/new-booking-dialog.tsx`
- Create: `src/components/admin/bookings/new-booking-model.ts`, holding the pure helpers below
- Test (new): `src/components/admin/bookings/new-booking-model.test.ts`
- Modify: `src/components/admin/bookings-tab.tsx:541-547`. The "New booking" `Link` becomes a `Button`, shown only when `role === "ADMIN"`. It opens the dialog. `onCreated` calls `goDay(booking.bookingDate)` and `day.reload()`, and shows "Booking ZEUS-XXXXXX saved as Pending."

**Interfaces:**
- `NewBookingDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange(open: boolean): void; onCreated(booking: DayBookingView): void })`.
- Model helpers:
  - `pickerData(data: DayAvailabilityData | null)` returns `{ days, nextAvailableDay } | null`. It drops `onlineBookingStatus`.
  - `nextKey(error: unknown, key: string, makeKey: () => string)` returns the same key for a
    RETRYABLE or network error, and a new key otherwise.

**Behaviour:**
- On open, the catalog is loaded with `adminRequest("/api/catalog")`.
- Availability uses `fetch("/api/availability?…")` (vehicle, body type, lines, `fromDate`, days 14).
  Its `quote` is the signed quote used for the total and on submit.
- Vehicle size is a select. When `BODY_TYPES_BY_SIZE` lists choices, a body-type select appears.
- Services: picked lines, each with a Remove button and, for `PANEL` units, a quantity. An "Add
  service" select lists bookable bases and compatible add-ons not yet picked.
  `selectionLines` and `catalogForBody` are reused as they are.
- The total uses `quoteTotal(quote)` and each line uses `lineAmount`.
- The day uses `DayPicker` with `pickerData(...)` and the notice "Choosing a day doesn't hold a
  place. The place is set when you save."
- Layout: `max-w-[1040px]` with two columns from `lg` up, one column below. Targets are 44 px,
  set with px classes (the admin root font is 92.5%).
- Errors from `AdminRequestError.fieldErrors` show under their fields, and the message goes in an
  alert at the top.

- [ ] Test (`new-booking-model.test.ts`):
  - `pickerData` drops `onlineBookingStatus` when it is PAUSED.
  - `nextKey` keeps the key for `AdminRequestError(503, { code: "RETRYABLE_ERROR" })` and for a `TypeError`.
  - `nextKey` changes the key for `SCHEDULE_CONFLICT`.
- [ ] Run it. Expect FAIL. Implement. Run it. Expect PASS.
- [ ] Build the dialog and wire the button.
- [ ] Run typecheck and lint. Expect exit 0 with zero warnings.
- [ ] Commit `feat(admin): New booking dialog on the Bookings page`.

### Task 5: Verification and evidence

- [ ] Run on the final SHA: `npm.cmd run typecheck`, `npm.cmd run lint`, the full `npm.cmd test` on a fresh DB, and `npm.cmd run build` in this worktree with the synthetic env (never the canonical root).
- [ ] Run a browser check on a local server with the synthetic fixture (scratchpad Playwright).
  Sign in as admin, open New booking, fill it in and save. The booking appears in the chosen
  day's queue as Pending. A detailer login sees no button. The page itself does not scroll.
- [ ] Take before and after screenshots of the Bookings page and the dialog at 1280 and 390 px, saved to the scratchpad.
- [ ] Self-review the diff. Hand over to the PM for a security-focused review from another session.
