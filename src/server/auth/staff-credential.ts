// Entry point for `npm run staff:credential` (an out-of-process operator command).
// It uses its own Prisma client with connection_limit=1, never the application pool.
import { PrismaClient } from "@prisma/client";
import { runStaffCredentialCli } from "./cli";

async function main(): Promise<number> {
  const raw = process.env.DATABASE_URL;
  let url: URL;
  try { url = new URL(raw ?? ""); } catch {
    process.stderr.write("DATABASE_URL is missing or not a URL.\n");
    return 1;
  }
  url.searchParams.set("connection_limit", "1");
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try {
    return await runStaffCredentialCli(process.argv.slice(2), { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, env: process.env }, db);
  } finally {
    await db.$disconnect();
  }
}

main().then((code) => process.exit(code), () => {
  process.stderr.write("Unexpected error. Nothing was confirmed.\n");
  process.exit(1);
});
