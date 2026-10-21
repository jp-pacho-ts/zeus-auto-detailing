# T-007 verification

Run the required repository checks with npm:

```powershell
npm run typecheck
npm run lint
npm run build
```

The nine pure availability tests need no database:

```powershell
npm exec --offline --call 'node --require ./src/server/__tests__/register.cjs --test ./src/server/__tests__/availability.test.ts'
```

For all 15 tests, provision a **new, empty local PostgreSQL database** whose name begins with `zeus_t007_`. Apply the existing Prisma schema without seeding it. Set both `T007_TEST_DATABASE_URL` and `DATABASE_URL` to that same database URL in the test process, then run:

```powershell
npm exec --offline --call 'node --require ./src/server/__tests__/register.cjs --test ./src/server/__tests__/availability.test.ts ./src/server/__tests__/booking.integration.test.ts'
```

The integration suite refuses nonlocal URLs, unequal URLs, or existing catalog/schedule/booking data. It creates its own fixtures and leaves them for inspection. Use a fresh database on each run. It never deletes rows or resets a database. Without the integration URL, six database tests are explicitly skipped; that is not a full verification run.

The test-only CommonJS loader uses the installed TypeScript compiler and resolves the existing @/ alias. It maps the Next.js server-only marker to Next's empty module so Node can execute the actual server code outside the React bundler. Database queries, transactions, advisory locks, Prisma, validation, and HTTP adapters run unchanged. No new dependencies or package scripts are required.

In this Windows sandbox, tsx could not read os.userInfo. The successful npm exec command used `C:/PROGRA~1/nodejs/node.exe` instead of `node`; this avoids quoting the space in Program Files in npm's cmd.exe child shell. PostgreSQL 18.6 was started on loopback port 55437 in an isolated ignored .npm-cache directory. No application environment file was changed.

Coverage: full-duration bottlenecks; four half-hour intervals for a two-hour reservation; exact half-open endpoints; partial final intervals; all noncancelled statuses; full and partial closures; capacity overrides; closing-time limits; malformed schedules; Manila horizon/past times; simultaneous final-bay submissions; normalized snapshot persistence; replay/conflict semantics; strict validation; uncached/public HTTP DTOs; malformed and oversized request bodies.

Browser smoke check: live catalog UUIDs → live arrival options → strict customer form → real Server Action → committed PENDING voucher. Confirmed synthetic reference ZEUS-DLOC8I against PostgreSQL (two hours, PHP 2,070). After reloading, its four half-hour intervals were Sold Out and 10:00 was available at the exact endpoint. Also verified Step 3 Continue opens an empty Step 4 without triggering validation; explicit submission still uses the form/action flow. Screenshots: booking-e2e.png and booking-navigation.png. They contain synthetic test details only.

## Runtime role (P1-10)

`npm test` includes `src/server/admin/runtime-role.integration.test.ts`. It provisions `zeus_app` with `prisma/sql/runtime-role.sql` and checks idempotency, both provisioning orders (on the empty database before `migrate deploy`, and after it; exact ACLs compared), refusal when `zeus_app` owns the `public` schema or the database, the ADR-003 deny list, the S-06 check and the production gate. It creates the extra sibling database `<T007 name>_runtime_role_early`. The loopback cluster must let `zeus_app` log in without a password (trust for 127.0.0.1); a deployed role gets one interactively.

After `npm test`, with the same two URLs, rerun the admin, create and auth suites with every service call as `zeus_app` (about 10 minutes; separate because it overloads the full parallel run):

```powershell
node --require ./src/server/__tests__/register.cjs --test src/server/runtime-role-suites.check.ts
```
