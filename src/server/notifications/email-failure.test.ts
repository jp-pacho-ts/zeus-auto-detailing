// P1-31: failed customer emails are classified and logged without any secret, and staff see plain words.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
// The per-address daily email cap counts across tests in one process; each test starts from zero.
beforeEach(async () => (await import("@/server/notifications/bookings")).resetSendGuard());
import { classifySmtpError, logEmailNotSent, resetEmailFailureLog, sendSmtpClassified, sendTurnNotice } from "./bookings";
import { notifyNotice } from "@/components/admin/bookings/model";

const lines: string[] = [];
const realWarn = console.warn;
function capture() { lines.length = 0; console.warn = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); }; }
afterEach(() => { console.warn = realWarn; resetEmailFailureLog(); });

test("P1-31: a mail library error is classed by its code only, never by its text", () => {
  const e = (code: string, extra: Record<string, unknown> = {}) => Object.assign(new Error("secret@example.test hunter2 Jane Doe"), { code, ...extra });
  assert.equal(classifySmtpError(e("EAUTH")), "auth_rejected");
  assert.equal(classifySmtpError(e("ETIMEDOUT")), "timeout");
  assert.equal(classifySmtpError(e("ECONNREFUSED")), "unreachable");
  assert.equal(classifySmtpError(e("ECONNECTION")), "unreachable");
  assert.equal(classifySmtpError(e("ESOCKET")), "unreachable");
  assert.equal(classifySmtpError(e("EDNS")), "unreachable");
  assert.equal(classifySmtpError(e("ESOCKET", { cause: { code: "ERR_SSL_WRONG_VERSION_NUMBER" } })), "tls_failed");
  assert.equal(classifySmtpError(e("EENVELOPE")), "refused");
  assert.equal(classifySmtpError(e("EMESSAGE")), "refused");
  assert.equal(classifySmtpError(e("SOMETHING_ELSE")), "error");
  assert.equal(classifySmtpError(new Error("no code")), "error");
  assert.equal(classifySmtpError("not an error"), "error");
});

test("P1-31: one log line per failed email carries only the kind, the reason class and the booking id", () => {
  capture();
  logEmailNotSent("turn_notice", "auth_rejected", "11111111-1111-4111-8111-111111111111");
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), { event: "booking.email_not_sent", kind: "turn_notice", reason: "auth_rejected", bookingId: "11111111-1111-4111-8111-111111111111" });
});

test("P1-31: missing settings log once per process, not once per booking", () => {
  capture();
  for (let i = 0; i < 4; i++) logEmailNotSent("customer_confirmation", "config_missing", "id-" + i);
  assert.equal(lines.filter((l) => l.includes("config_missing")).length, 1);
  logEmailNotSent("customer_confirmation", "timeout", "id-9");
  logEmailNotSent("customer_confirmation", "timeout", "id-10");
  assert.equal(lines.length, 3, "other reasons log every time");
});

test("P1-31: with no shop email settings a staff notice is NOT_SENT and the log says config_missing, nothing else", async () => {
  capture();
  const saved = { ...process.env };
  for (const k of Object.keys(process.env)) if (k.startsWith("SMTP_") || k.startsWith("RESEND_")) delete process.env[k];
  try {
    assert.equal(await sendTurnNotice("11111111-1111-4111-8111-111111111111"), "NOT_SENT");
  } finally { Object.assign(process.env, saved); }
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).reason, "config_missing");
});

test("P1-31: an unreachable mail server is classed unreachable and the log never holds the address or password", async () => {
  capture();
  const config = { host: "127.0.0.1", port: 9, secure: false, user: "shop@example.test", password: "hunter2-app-password", from: "Zeus <shop@example.test>", shopEmail: "shop@example.test", origin: "http://localhost:3000" };
  const result = await sendSmtpClassified(config, "jane.doe@example.test", { subject: "s", text: "t" }, "<m@localhost>");
  assert.ok(["unreachable", "timeout", "tls_failed", "error"].includes(result), result);
  assert.notEqual(result, "sent");
  logEmailNotSent("turn_notice", result as Exclude<typeof result, "sent">, "id");
  for (const secret of ["jane.doe@example.test", "hunter2-app-password", "shop@example.test", "Jane"]) assert.ok(!lines.join("\n").includes(secret), secret);
});

test("P1-31: staff read plain words for every email outcome, never a rate-limit text or a code label", () => {
  assert.equal(notifyNotice("SENT"), "Email sent.");
  assert.equal(notifyNotice("NOT_SENT"), "Email could not be sent. The shop email is not set up or was refused, so nothing went out. Try again, or phone the customer.");
  assert.equal(notifyNotice("NO_EMAIL"), "No customer email address is on file.");
  for (const n of ["SENT", "NOT_SENT", "NO_EMAIL"] as const) assert.doesNotMatch(notifyNotice(n), /429|RATE|NOT_SENT|SMTP|notified recently/);
});
