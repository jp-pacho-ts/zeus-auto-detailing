// P1-78 Settings tools: the email preview and the test email. No database: neither tool reads or writes one. The send goes to the
// loopback SMTP simulator; synthetic values only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, beforeEach, test } from "node:test";
import { assertCustomerHtmlPrivate } from "@/server/notifications/email-privacy.fixture";
import { resetSendGuard } from "@/server/notifications/bookings";
import { smtpSimulation } from "@/server/notifications/smtp.fixture";
import type { StaffActor } from "./context";
import type { AdminServiceError } from "./errors";
import { setAdminEventSink } from "./log";
import { previewEmail, resetTestEmailLimit, sendTestEmail } from "./settings-tools";

const ADMIN: StaffActor = { staffId: randomUUID(), role: "ADMIN", sessionId: randomUUID() };
const STAFF: StaffActor = { ...ADMIN, role: "STAFF" };
const ORIGIN = "https://zeus-p178.invalid";
const events: { event: string; fields: Record<string, unknown> }[] = [];
setAdminEventSink((event, fields) => { events.push({ event, fields }); });
const keepOrigin = process.env.APP_ORIGIN;
process.env.APP_ORIGIN = ORIGIN;
after(() => {
  setAdminEventSink((event, fields) => console.info(JSON.stringify({ event, ...fields })));
  if (keepOrigin === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = keepOrigin;
});
beforeEach(() => { resetTestEmailLimit(); resetSendGuard(); events.length = 0; });

const code = (e: unknown) => (e as AdminServiceError).adminCode;
async function refused(p: Promise<unknown>, expected: string, label: string) {
  await assert.rejects(p, (e: unknown) => { assert.equal(code(e), expected, label); return true; }, label);
}
// Every console line written while work runs.
async function consoleLines<T>(work: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const lines: string[] = [];
  const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  for (const level of ["log", "info", "warn", "error"] as const) console[level] = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try { return { value: await work(), lines }; } finally { Object.assign(console, saved); }
}

test("P1-78 preview: each kind renders the fixed sample booking, with no private or staff-only text and no token link", async () => {
  for (const kind of ["confirmation", "reminder", "car_ready"] as const) {
    const p = await previewEmail(ADMIN, { kind });
    assert.equal(p.kind, kind);
    assert.ok(p.subject.length > 0 && p.text.includes("ZEUS-PREVIEW"), kind);
    assert.ok(p.html, kind + " has an HTML part");
    // Security C5: reserved fake contact values; none can appear, and neither can any staff-only text.
    assertCustomerHtmlPrivate(p.html, "ZEUS-PREVIEW", ["+63 900 000 0000", "preview@example.invalid", "TEST 000"], kind);
    assert.doesNotMatch(p.html + p.text, /token|accessToken|grant=/i, kind + ": no token link");
  }
  const turn = await previewEmail(ADMIN, { kind: "turn_notice" });
  assert.equal(turn.html, null, "the turn notice is text only (CEO D-4)");
  assert.deepEqual(events.map((e) => [e.event, e.fields.kind]), [["admin.settings.email_preview", "confirmation"], ["admin.settings.email_preview", "reminder"],
    ["admin.settings.email_preview", "car_ready"], ["admin.settings.email_preview", "turn_notice"]]);
});

test("P1-78 preview: ADMIN only, the kind only, and it fails closed without APP_ORIGIN", async () => {
  await refused(previewEmail(STAFF, { kind: "confirmation" }), "FORBIDDEN", "staff");
  await refused(previewEmail(ADMIN, { kind: "deposit" }), "VALIDATION_ERROR", "unknown kind");
  await refused(previewEmail(ADMIN, { kind: "confirmation", bookingId: randomUUID() }), "VALIDATION_ERROR", "an extra key");
  delete process.env.APP_ORIGIN;
  try { await refused(previewEmail(ADMIN, { kind: "confirmation" }), "RETRYABLE_ERROR", "no APP_ORIGIN"); } finally { process.env.APP_ORIGIN = ORIGIN; }
});

test("P1-78 test email: one message to the configured shop address only; the answer and the logs never carry the address", async () => {
  const smtp = await smtpSimulation();
  try {
    const { value, lines } = await consoleLines(() => sendTestEmail(ADMIN, {}, { notification: smtp.config }));
    assert.equal(value.result, "sent");
    assert.equal(smtp.messages.length, 1);
    assert.equal(smtp.messages[0].to, smtp.config.shopEmail);
    assert.match(smtp.messages[0].subject, /^Test email from /);
    const seen = JSON.stringify(value) + JSON.stringify(events) + lines.join("\n");
    assert.ok(!seen.includes(smtp.config.shopEmail), "the address is in no answer, event or log line");
    assert.deepEqual(events.map((e) => e.fields), [{ actorStaffId: ADMIN.staffId, result: "sent" }]);
  } finally { await smtp.close(); }
});

test("P1-78 test email: a rejected send and a missing configuration answer with a reason class only", async () => {
  const smtp = await smtpSimulation();
  try {
    smtp.setRejected(true);
    const rejected = await sendTestEmail(ADMIN, {}, { notification: smtp.config });
    assert.ok(["auth_rejected", "refused", "error"].includes(rejected.result), rejected.result);
    assert.ok(!JSON.stringify(rejected).includes(smtp.config.shopEmail));
  } finally { await smtp.close(); }
  assert.equal((await sendTestEmail(ADMIN, {}, { notification: null })).result, "config_missing");
});

test("P1-78 test email: no input can name a recipient", async () => {
  const smtp = await smtpSimulation();
  try {
    await refused(sendTestEmail(ADMIN, { to: "someone@example.test" }, { notification: smtp.config }), "VALIDATION_ERROR", "a to key");
    await refused(sendTestEmail(ADMIN, { email: "someone@example.test" }, { notification: smtp.config }), "VALIDATION_ERROR", "an email key");
    assert.equal(smtp.attempts.length, 0, "nothing was sent");
  } finally { await smtp.close(); }
});

test("P1-78 test email: 3 attempts per 10 minutes for the shop, failed ones included; a refused STAFF call uses none", async () => {
  for (let i = 0; i < 5; i++) await refused(sendTestEmail(STAFF, {}, { notification: null }), "FORBIDDEN", "staff");
  const other: StaffActor = { ...ADMIN, staffId: randomUUID(), sessionId: randomUUID() };
  for (const actor of [ADMIN, other, ADMIN]) assert.equal((await sendTestEmail(actor, {}, { notification: null })).result, "config_missing");
  await assert.rejects(sendTestEmail(other, {}, { notification: null }), (e: unknown) => {
    assert.equal(code(e), "RATE_LIMITED");
    assert.equal((e as AdminServiceError).retryAfterSeconds, 600);
    return true;
  }, "the 4th attempt, by another admin, is limited: the limit is the shop's");
  assert.deepEqual(events.map((e) => e.fields.result), ["config_missing", "config_missing", "config_missing", "rate_limited"], "every outcome is logged (Security C2)");
  assert.ok(events.every((e) => e.event === "admin.settings.test_email" && Object.keys(e.fields).sort().join() === "actorStaffId,result"));
});
