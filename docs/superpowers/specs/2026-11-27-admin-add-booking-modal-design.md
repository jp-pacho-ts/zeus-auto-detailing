# Admin "New booking" modal: design

Date: 2026-11-27. Decided with the CEO (LE) in conversation.

## Intent

The admin enters bookings for people who don't book online: walk-ins, phone callers and
seniors who can't use the website. Today the Bookings page's "New booking" button
(`src/components/admin/bookings-tab.tsx:542`) links to the public `/book` page. That page
is built for strangers, so it blocks the admin:

- **Turnstile:** every booking needs the "are you human" check.
- **Per-client limit (3/hour, 6/day):** it is keyed on the client IP (`trustedClientKey`).
  Every device at the shop shares one IP, so the admin is stopped after the 3rd walk-in
  in an hour.
- **Online pause and daily cap:** when online booking is paused, or the shop's daily
  budget is used up, `/book` refuses everyone, including the admin.

The goal is an admin-only modal on the Bookings page that books through the same
booking engine and skips only those stranger checks.

## Goals

- "New booking" opens a modal on the Bookings page instead of linking to `/book`.
- Only the ADMIN role (Admin and Manager logins) can open it or call its endpoint.
  Detailer (STAFF) logins are refused by the service, not just hidden in the UI.
- Bookings are saved exactly as online bookings are: QUEUE_V3, status **PENDING**, in the
  day queue at the next position. The admin then uses the existing Confirm and deposit
  actions.
- The customer gets the same confirmation email as online customers when an email is given.

## Non-goals

- Saving as CONFIRMED, or taking the deposit, in the modal (approach C; rejected).
- Booking onto a full or closed day. The admin picks another day, the same rule customers follow.
- Choosing a bay or workers at creation. The existing board actions do that.
- Recording which admin created the booking. That would need a schema change; logged only.
- Any change to `/book` or to the public booking rules.

## Anti-goals (a failure even if it works)

- A second copy of the booking-write rules that can drift from the public path.
- Any way to reach the stranger-check bypass without an ADMIN session.
- Any weakening of the public path's checks.

## Constraints

- Booking writes keep the transaction and advisory locks: `lockBookingShop` then `lockBookingDates`.
- Zod validates server input. Authorization happens inside the service and fails closed.
  Modules are `server-only`.
- No schema or migration change. Money stays in integer centavos. Shop time zone is Asia/Manila.
- Customers never see bays, capacity counts, workers or staff-entered reasons.

## Approaches

- **A. Reuse the public create engine with an admin entry point (picked).** The admin
  path runs the same transaction and rules, and skips only the stranger checks. One
  source of truth, moderate work, and it needs a security review.
- **B. Write a separate admin create service.** It duplicates about 290 lines of booking
  rules, and the two copies drift. Rejected.
- **C. Like A, but saved CONFIRMED with the deposit handled.** It saves two clicks, but
  adds a new way for a booking to start life that every report and deposit path must
  handle. Rejected for now; it can be added on top of A later.

## Decided design

### Server

1. **Permission.** Add `BOOKING_CREATE` to `ADMIN_OPS` in `src/server/admin/roles.ts`.
   Do not add it to `STAFF_OPS`. The new service calls `authorize(actor, "BOOKING_CREATE")` first.
2. **One engine, two entry points.** Split `createDayBooking`
   (`src/server/bookings-create.ts`) so the commit transaction is shared. The public
   `createDayBooking(input, options)` must behave exactly as today, and every existing
   test must pass unchanged. Add `createAdminDayBooking(actor, input, options)`.
3. **Admin input schema.** Use `CreateDayBookingSchema` without `turnstileToken`, and
   keep everything else, including the quote-match refinement and the name rules. The
   current schema applies `.superRefine`/`.transform` after `.extend`, so build both
   variants from a shared base object.
4. **The admin path skips:**
   - the `x-zeus-booking` origin header check. `adminRoute` already enforces
     same-origin and the session.
   - the per-IP create admission limiter (`enterBooking`/`createAdmission`). The DB
     pools stay.
   - the per-client 3/hour and 6/day budget, and the shop daily budget.
   - the online-booking pause, from both the env mode and the database switch.
   - Turnstile verification and the `bookingTurnstileUse` rows.
5. **The admin path keeps:** idempotency and replay, the accepted-quote check, the
   today-through-90-days rule, the phone rule (at most 2 active bookings per phone),
   refusal of closed and fully booked days (`readDayStates`), queue position, line
   items, the shop notification outbox row, the customer confirmation email and the
   pending-count alert log.
   - The phone-rule message on the admin path reads "This phone number already has 2
     active bookings." The public "call the shop" wording makes no sense to the shop.
6. **Ledger row.** The admin `BookingOperation` gets a `clientHash` that marks it as
   admin-made. Proposed: `"admin:" + sha256(staffId)`. Check first whether any constraint
   or reader assumes the hash format. `counts()` excludes these rows, so admin bookings
   never use up the online per-client or shop daily budget. *(Builder's call, flagged to the CEO.)*
7. **Credentials.** Mint them as today, because replay depends on them. The admin
   response returns the booking view only: no `managementAccess` and no session cookie.
8. **Route.** Add `POST` to `src/app/api/admin/bookings/route.ts` through
   `adminRoute(request, (actor, body) => admin.createBooking(actor, body))`. Export the
   service from `src/server/admin/index.ts`. Errors use the admin error envelope with
   field errors carried through, so the modal can show them next to the fields.
9. **Log.** Write `adminEvent("admin.booking_created", …)` with the booking id and the
   staff id. Include no PII.

### Modal (UI)

- `src/components/admin/bookings/new-booking-dialog.tsx`, built from `components/ui`
  (`dialog`, `input`, `select`, `button`) and the existing admin tokens.
- **Fields:** first name, last name, phone, optional email, vehicle size, vehicle
  model, optional plate, service lines, optional notes, and the day.
- **Data:** the catalog comes from `GET /api/catalog`. Days and the signed quote come
  from `GET /api/availability`, the same calls the wizard makes. Reuse the wizard's
  helpers (`day-booking.ts`, `public-slot.ts`) instead of re-deriving logic. Closed and
  full days cannot be chosen.
- **Submit:** POST to `/api/admin/bookings` with a fresh v4 `idempotencyKey`, reused on retry.
- **On success:** close the modal, show the booking reference, switch the board to that
  day and refresh it.
- **Button:** "New booking" becomes a button that opens the dialog, shown only when
  `role === "ADMIN"`.
- **Targets:** use px classes for 44 px touch targets. The admin root font is 92.5%, so
  rem-based sizes come out smaller.

### Tests

- **Service, on a DB:** the admin path books while paused, past the per-IP limit and
  past the daily cap, with no Turnstile token. It refuses full and closed days, the
  STAFF role and a 3rd active booking on one phone. Replay is idempotent. Admin bookings
  do not count toward the public budgets. The public path is unchanged: all existing
  create suites stay green.
- **Route:** the POST is listed and guarded (`src/server/admin/routes.test.ts` pattern).
- **UI:** a unit test for the form state and a browser check: open, fill, submit, then
  find the booking in the day queue. The page itself must not scroll.

## Left to the builder

- The exact internal split of `createDayBooking`, provided the public behavior is identical.
- Error wording beyond the phone rule, and how the form lays out.
- Whether the dialog reuses wizard sub-components directly or only its helpers.

## Verification and review

Run typecheck, lint, tests, build and the DB suites on a fresh `zeus_t007_*` loopback DB.
Take before and after screenshots. The work touches the backend and the bypass of
security checks, so it needs a review from a different session, with a security focus.
