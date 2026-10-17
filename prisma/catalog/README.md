# P1-01 catalog data and local maintenance

This slice creates **draft data only**. It does not connect the website to the new
catalog (P1-02), migrate Railway, create staff accounts, or publish automatically.
Never run the historical demo seed. `prisma/seed.ts` now requires an explicit local
DATABASE_URL and CATALOG_SOURCE_PATH; no environment file is copied or loaded by
our scripts. Prisma/Next CLI commands must run in this isolated worktree with no
.env file. All maintenance commands reject non-loopback database URLs.

## Data contract

`manifest.json` is the single reviewed price manifest: 21 services, 105 explicit
MOTOR/S/M/L/XL pairs, source SHA-256, source date/path, deterministic service/size
UUIDs and per-row provenance. Amounts are integer centavos. N is NOT_OFFERED, U is
UNCONFIRMED; neither is a zero price. Only plain washes have TIMED 30/35/45 plans.
All other services/compositions are quote-first, UNKNOWN duration, with no holds.
Panel repaint has a 350000-centavo service reference, PANEL unit and unconfirmed
size fitment. Add-on compatibility is three washes x two add-ons, S/M/L/XL;
compositions cannot be booked until an accepted composite-duration contract exists.

`compareAtCentavos` is constrained to NULL; `sourceCompareAtCentavos` preserves
printed regular prices internally, including Arcane S 2883300. Charged Arcane S
is 1310000. No inferred motorcycle regular price, public ratings, card acceptance
or promo dates. New reviewed versions must preserve exact source data; a changed
source requires updating the checked-in manifest and reconciliation evidence.

Legacy categories/services/booking IDs, hashes and snapshots are retained.
Nullable legacy identity fields carry no fake prices/durations/multipliers.
New service identities are inactive for the old application. Publication retires
old services but does not activate new ones in the old multiplier application.
P1-02 must select the published head and exact offers; it must not fall back to
legacy fields. Existing bookings remain LEGACY_V1 without fabricated line items.
New CATALOG_V2 line totals/offer identities are transactionally constrained.

Database checks/FKs enforce money, shape, size, work plans, compatibility,
snapshot totals and immutability. The loader checks the reviewed manifest and
source hash; publication independently compares stored rows to the canonical
manifest and its approved hash. Published release data and size identities are
immutable. Rollback creates a new version with new offer IDs and a new hash.

## Commands (PowerShell, local synthetic resources only)

Set DATABASE_URL explicitly to your disposable loopback database; do not copy .env.
Set CATALOG_SOURCE_PATH to the canonical `docs/client/service-catalog.md` path.

    node node_modules/prisma/build/index.js migrate deploy
    node node_modules/prisma/build/index.js generate
    node prisma/catalog/cli.mjs seed --source "$env:CATALOG_SOURCE_PATH"

Seed is idempotent for identical version/hash. A matching hash with tampered DB
rows fails; same version/different content fails; the active head is untouched.

Publication is a separate owner-run maintenance operation, using a dedicated DB
login, not an HTTP route. The database migration owner provisions an existing
non-owner, non-superuser login via `prisma/sql/catalog-publisher.sql` with psql
variables publisher_role and actor_staff_id. Never grant that login role creation,
owner membership, mapping-table writes, direct catalog writes or audit writes.
The mapping is to an active Staff row whose role is ADMIN (MANAGER maps to ADMIN
under ADR-003); DETAILER/inactive/unmapped logins fail inside the definer service.
The database session identity supplies the actor; there is no role argument.
`zeus_app` has read-only catalog access and cannot execute publication.
Production-equivalent login provisioning is a DOE/LE-approved later operation.

    node prisma/catalog/cli.mjs publish --release <id> --hash <independently-reviewed-manifest-sha256> --review <review-report-reference> --reason <reason>

One transaction takes pg_advisory_xact_lock(746001,1), verifies authority and all
rows/hash, retires the prior release, changes the singleton head and appends the
audit event (actor, DB login, review/reason, old/new releases and hashes, source,
time). Audit failure rolls everything back. Privilege separation and immutable
triggers deny runtime/publisher edits and audit UPDATE/DELETE/TRUNCATE. The DB
owner is trusted and can necessarily administer triggers/grants; runtime must
never use owner credentials. Published data must never be edited in place.

For rollback, use the owner connection to create a new draft of the previous
manifest, then independently review its new hash and publish through the mapped
operator. A ROLLBACK: reason records the action distinctly. No destructive SQL:

    node prisma/catalog/cli.mjs rollback-draft --release <previous-release-id> --version <new-unique-version> --source "$env:CATALOG_SOURCE_PATH"
    node prisma/catalog/cli.mjs publish --release <new-id> --hash <new-reviewed-hash> --review <review-reference> --reason "ROLLBACK: <prior-release-id> <reason>"

## Verification

`node prisma/catalog/verify.mjs` creates fresh synthetic loopback databases without
dropping/resetting anything, applies baseline + legacy fixture + additive catalog
migration, runs source/DB/security/compatibility checks and the existing booking
suite on a separate empty migrated DB. Requires PostgreSQL 18 client binaries via
PG_BIN, explicit CATALOG_TEST_DATABASE_URL (loopback admin connection), and
CATALOG_SOURCE_PATH. It preserves databases for inspection and runs no live calls.

    $env:PG_BIN='C:/Program Files/PostgreSQL/18/bin'
    $env:CATALOG_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55461/postgres'
    node prisma/catalog/verify.mjs

The direct regression command uses DATABASE_URL pointing to the generated catalog
DB and the existing TS test loader:

    node --require ./src/server/__tests__/register.cjs --test prisma/catalog/compatibility.test.cjs

`CATALOG_GUARD_BASELINE=1` executes the exact original 72f240a consumer sources
in memory and must fail all three null cases; no source files are restored/edited.
The normal run must pass. This is a regression control, not a supported runtime mode.

## Forward / verify / rollback

The historical baseline runbook is `.team/handoffs/T-045-data-to-coordinator.md`;
it was NOT executed live. Apply baseline first, then the additive catalog migration
on a backed-up local copy with populated legacy fixtures. Verify migrate status,
zero Prisma schema drift, source-vs-DB reconciliation and unmodified legacy
snapshots. There are no row deletions or automatic repricing. Do not edit the
baseline. If verification fails, stop and retain evidence; do not reset/revert.
For bad published prices, publish a reviewed new rollback version. Reversing the
schema is not automated: nullable identities/new history must be retained, and a
restore or destructive reverse migration needs separate LE approval. Production
backup, migrate resolve/deploy, principals and publication belong to P1-13 and each
requires LE approval. No production readiness or independent QA PASS is claimed.