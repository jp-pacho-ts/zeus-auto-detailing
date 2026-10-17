import { PrismaClient } from "@prisma/client";

// P1-01: no demo accounts, invented prices, schedule edits or implicit publication.
async function main() {
  const { requireLocalDatabase, seedCatalog } = await import("./catalog/catalog.mjs");
  const prisma = new PrismaClient({ datasourceUrl: requireLocalDatabase(process.env.DATABASE_URL) });
  try {
    const result = await seedCatalog(prisma, { sourcePath: process.env.CATALOG_SOURCE_PATH });
    console.log(JSON.stringify(result));
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error("Catalog draft seed failed; see prisma/catalog/README.md."); process.exitCode = 1; });