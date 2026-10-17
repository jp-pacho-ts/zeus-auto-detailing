import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { requireLocalDatabase } from './catalog.mjs';
const adminUrl = requireLocalDatabase(process.env.CATALOG_TEST_DATABASE_URL);
assert.equal(new URL(adminUrl).pathname, '/postgres', 'Use a disposable loopback cluster admin connection to /postgres');
assert.ok(process.env.CATALOG_SOURCE_PATH, 'Explicit canonical source document path required');
assert.ok(process.env.PG_BIN, 'Set PG_BIN to the PostgreSQL client binary directory');
const pg = join(process.env.PG_BIN, process.platform === 'win32' ? 'psql.exe' : 'psql');
const stamp = Date.now().toString(36);
const admin = new PrismaClient({ datasourceUrl: adminUrl });
function run(executable, args, env, expected = 0) {
    console.log(JSON.stringify({ command: [executable, ...args.filter(a => !String(a).startsWith('postgresql:'))] }));
    const result = spawnSync(executable, args, { env: { ...process.env, ...env }, stdio: 'inherit', shell: false });
    if (result.error)
        throw result.error;
    console.log('exit_status=' + result.status);
    assert.equal(result.status, expected, 'Unexpected command exit status');
}
function prisma(args, env) { run(process.execPath, ['node_modules/prisma/build/index.js', ...args], env); }
async function create(name) { assert.match(name, /^(p1_01_catalog|zeus_t007)_[a-z0-9]+$/); await admin.$executeRawUnsafe(`CREATE DATABASE ${name}`); const u = new URL(adminUrl); u.pathname = '/' + name; return u.toString(); }
try {
    // The migration grants catalog reads only when the runtime role already exists.
    // Bootstrap it through the isolated cluster owner, before either migrate deploy.
    const runtimeRoles = await admin.$queryRaw`SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app'`;
    if (!runtimeRoles.length)
        await admin.$executeRawUnsafe('CREATE ROLE zeus_app LOGIN');
    console.log('Prepared zeus_app runtime role before migrations');
    const catalogUrl = await create('p1_01_catalog_' + stamp);
    const env = { DATABASE_URL: catalogUrl, CATALOG_TEST_DATABASE_URL: catalogUrl, CATALOG_SOURCE_PATH: process.env.CATALOG_SOURCE_PATH };
    const u = new URL(catalogUrl), connect = ['-h', u.hostname, '-p', u.port || '5432', '-U', decodeURIComponent(u.username), '-d', u.pathname.slice(1), '-v', 'ON_ERROR_STOP=1'];
    // Apply baseline and populated legacy fixture before marking it applied, then deploy additive schema.
    run(pg, [...connect, '-f', 'prisma/migrations/20261017000000_baseline/migration.sql'], env);
    run(pg, [...connect, '-f', 'prisma/catalog/legacy-fixture.sql'], env);
    prisma(['migrate', 'resolve', '--applied', '20261017000000_baseline'], env);
    prisma(['migrate', 'deploy'], env);
    prisma(['migrate', 'status'], env);
    prisma(['migrate', 'diff', '--from-url', catalogUrl, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'], env);
    run(process.execPath, ['--test', 'prisma/catalog/source.test.mjs', 'prisma/catalog/integration.test.mjs'], env);
    run(process.execPath, ['--test', 'prisma/catalog/provision.test.mjs'], env);
    run(process.execPath, ['--require', './src/server/__tests__/register.cjs', '--test', 'prisma/catalog/compatibility.test.cjs'], { ...env, CATALOG_GUARD_BASELINE: '1' }, 1);
    run(process.execPath, ['--require', './src/server/__tests__/register.cjs', '--test', 'prisma/catalog/compatibility.test.cjs'], { ...env, CATALOG_GUARD_BASELINE: '' });
    const bookingUrl = await create('zeus_t007_' + stamp);
    const bookingEnv = { DATABASE_URL: bookingUrl, T007_TEST_DATABASE_URL: bookingUrl };
    prisma(['migrate', 'deploy'], bookingEnv);
    run(process.execPath, ['--require', './src/server/__tests__/register.cjs', '--test', './src/server/__tests__/availability.test.ts', './src/server/__tests__/booking.integration.test.ts'], bookingEnv);
    console.log(JSON.stringify({ catalogDatabase: u.pathname.slice(1), bookingDatabase: new URL(bookingUrl).pathname.slice(1), result: 'PASS', preserved: true }));
}
finally {
    await admin.$disconnect();
}
