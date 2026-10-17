import "server-only";
import { parseArgs } from "node:util";
import type { PrismaClient } from "@prisma/client";
import { deactivateStaff, reactivateStaff, setStaffPassword, unlockStaffCredential, type CredentialResult } from "./credentials";
import { STAFF_PASSWORD_REJECTION_MESSAGES } from "./password";
import type { StaffRole } from "./policy";

// npm run staff:credential -- <command> --email <email> [...]
//   set-password --email <email> [--name <name>] [--role ADMIN|MANAGER|DETAILER] [--phone <phone>]
//   unlock | deactivate | reactivate --email <email>
// The password comes from a no-echo prompt (asked twice; paste works) or, once, from
// STAFF_BOOTSTRAP_PASSWORD, which is removed from the environment after reading.
// It is never taken from argv, printed or logged.

export interface CliInput extends NodeJS.EventEmitter {
  isTTY?: boolean;
  setRawMode?: (on: boolean) => unknown;
  setEncoding(encoding: BufferEncoding): unknown;
  resume(): unknown;
  pause(): unknown;
}
export interface CliIo {
  stdin: CliInput;
  stdout: { write(s: string): boolean };
  stderr: { write(s: string): boolean };
  env: Record<string, string | undefined>;
}

const USAGE = `Usage:
  staff:credential set-password --email <email> [--name <name>] [--role ADMIN|MANAGER|DETAILER] [--phone <phone>]
  staff:credential unlock --email <email>
  staff:credential deactivate --email <email>
  staff:credential reactivate --email <email>
`;
const ROLES: readonly StaffRole[] = ["ADMIN", "MANAGER", "DETAILER"];

class PromptAborted extends Error {}

// Reads hidden lines from a raw-mode TTY. Buffered, so a paste that contains both
// answers still splits correctly. Only Enter ends a line; Backspace deletes a code point.
function hiddenLineReader(input: CliInput) {
  let pending = ""; // raw input not yet consumed
  let line = ""; // edited text of the current line
  let afterCR = false; // a pasted "\r\n" ends one line, not two
  let waiting: { resolve: (line: string) => void; reject: (e: Error) => void } | null = null;
  const pump = () => {
    while (waiting && pending.length > 0) {
      const c = String.fromCodePoint(pending.codePointAt(0)!);
      pending = pending.slice(c.length);
      const skip = afterCR && c === "\n";
      afterCR = c === "\r";
      if (skip) continue;
      if (c === "\r" || c === "\n") {
        const w = waiting; waiting = null;
        const done = line; line = "";
        w.resolve(done);
      } else if (c === "\u0003" || c === "\u0004") {
        const w = waiting; waiting = null;
        pending = ""; line = "";
        w.reject(new PromptAborted());
      } else if (c === "\u007f" || c === "\b") {
        line = Array.from(line).slice(0, -1).join("");
      } else {
        line += c; // anything else, including other control characters, goes to the schema
      }
    }
  };
  const onData = (chunk: string) => { pending += chunk; pump(); };
  input.setEncoding("utf8");
  input.on("data", onData);
  return {
    read(): Promise<string> {
      return new Promise((resolve, reject) => { waiting = { resolve, reject }; pump(); });
    },
    close() { input.removeListener("data", onData); },
  };
}

async function readPassword(io: CliIo): Promise<string> {
  const fromEnv = io.env.STAFF_BOOTSTRAP_PASSWORD;
  if (fromEnv !== undefined) {
    delete io.env.STAFF_BOOTSTRAP_PASSWORD; // read once; the operator unsets it on the host too
    return fromEnv;
  }
  if (!io.stdin.isTTY || !io.stdin.setRawMode) {
    throw new Error("Run this in an interactive terminal, or set STAFF_BOOTSTRAP_PASSWORD for a one-off command.");
  }
  io.stdin.setRawMode(true);
  io.stdin.resume();
  const reader = hiddenLineReader(io.stdin);
  try {
    io.stdout.write("New password (not shown): ");
    const first = await reader.read();
    io.stdout.write("\nRepeat the password: ");
    const second = await reader.read();
    io.stdout.write("\n");
    if (first !== second) throw new Error("The two passwords did not match. Nothing was changed.");
    return first;
  } finally {
    reader.close();
    io.stdin.setRawMode(false);
    io.stdin.pause();
  }
}

function report(io: CliIo, result: CredentialResult, done: string): number {
  if (result.ok) { io.stdout.write(`${done} (staff ${result.staffId}).\n`); return 0; }
  if (result.reason === "REJECTED") {
    io.stderr.write(`Password rejected (${result.rejection}): ${STAFF_PASSWORD_REJECTION_MESSAGES[result.rejection]} Nothing was changed.\n`);
    return 3;
  }
  io.stderr.write(`${result.reason}: ${result.message}\n`);
  return result.reason === "USAGE" ? 2 : 1;
}

export async function runStaffCredentialCli(argv: string[], io: CliIo, db: PrismaClient): Promise<number> {
  const [command, ...rest] = argv;
  let values: { email?: string; name?: string; role?: string; phone?: string };
  try {
    ({ values } = parseArgs({
      args: rest, strict: true, allowPositionals: false,
      options: { email: { type: "string" }, name: { type: "string" }, role: { type: "string" }, phone: { type: "string" } },
    }));
  } catch {
    io.stderr.write(USAGE); // never echo the arguments: a mistyped flag may carry a secret
    return 2;
  }
  const email = values.email?.trim();
  const isSet = command === "set-password";
  if (!email || !["set-password", "unlock", "deactivate", "reactivate"].includes(command ?? "")
    || (!isSet && (values.name || values.role || values.phone))) {
    io.stderr.write(USAGE);
    return 2;
  }
  if (values.role !== undefined && !ROLES.includes(values.role as StaffRole)) {
    io.stderr.write("--role must be ADMIN, MANAGER or DETAILER.\n");
    return 2;
  }
  try {
    if (command === "unlock") return report(io, await unlockStaffCredential(db, email), "Unlocked");
    if (command === "deactivate") return report(io, await deactivateStaff(db, email), "Deactivated; every session was revoked");
    if (command === "reactivate") return report(io, await reactivateStaff(db, email), "Reactivated; earlier sessions stay revoked");
    const password = await readPassword(io);
    const result = await setStaffPassword(db, { email, name: values.name, role: values.role as StaffRole | undefined, phone: values.phone }, password);
    return report(io, result, result.ok && result.created ? "Staff member and password created" : "Password set; earlier sessions were revoked");
  } catch (error) {
    if (error instanceof PromptAborted) { io.stderr.write("\nCancelled. Nothing was changed.\n"); return 1; }
    // Never print driver errors: they can include connection details.
    io.stderr.write(error instanceof Error && !("clientVersion" in error) ? `${error.message}\n` : "Database error. Nothing was confirmed; check the database and run the command again.\n");
    return 1;
  }
}
