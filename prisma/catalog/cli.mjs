import { PrismaClient } from '@prisma/client';
import { readManifest, requireLocalDatabase, seedCatalog, publishCatalog, rollbackManifest, canonical, sha256 } from './catalog.mjs';
const [command, ...args] = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith('--') || !args[i + 1])
        throw Error('Expected --name value');
    flags[args[i].slice(2)] = args[i + 1];
}
const db = new PrismaClient({ datasourceUrl: requireLocalDatabase(process.env.DATABASE_URL) });
try {
    if (command === 'seed') {
        const result = await seedCatalog(db, { manifest: readManifest(), sourcePath: flags.source });
        console.log(JSON.stringify(result));
    }
    else if (command === 'publish') {
        const result = await publishCatalog(db, { releaseId: flags.release, approvedManifestSha256: flags.hash, reviewReference: flags.review, reason: flags.reason });
        console.log(JSON.stringify(result));
    }
    else if (command === 'rollback-draft') {
        const original = await db.catalogRelease.findUniqueOrThrow({ where: { id: flags.release } });
        if (original.state === 'DRAFT')
            throw Error('Rollback requires a previously published release');
        const manifest = rollbackManifest(JSON.parse(original.manifestJson), flags.version);
        const result = await seedCatalog(db, { manifest, sourcePath: flags.source });
        console.log(JSON.stringify({ ...result, action: 'Draft only; separately review and publish with ROLLBACK: reason', manifestSha256: sha256(canonical(manifest)) }));
    }
    else
        throw Error('Use seed, publish, or rollback-draft; see prisma/catalog/README.md');
}
catch {
    console.error('Catalog maintenance failed; no credentials or customer data logged. Inspect with the local database owner.');
    process.exitCode = 1;
}
finally {
    await db.$disconnect();
}
