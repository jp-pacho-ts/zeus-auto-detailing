// P1-78 UI (items 1 and 5): the email preview is shown only in an empty-sandbox srcdoc frame (Security C3), the turn notice is text
// only, and the test email offers no address field. Server-rendered, no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmailPreviewView, EmailTools } from "./email-tools";

const html = (type: unknown, props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(type as never, props));
const source = readFileSync(join(__dirname, "email-tools.tsx"), "utf8");

test("an HTML email shows only inside an empty-sandbox srcdoc frame, with its subject and a plain text version", () => {
  const out = html(EmailPreviewView, {
    label: "Booking confirmation",
    preview: { kind: "confirmation", subject: "Booking received", text: "Hello <b>there</b>", html: "<p>Hi <script>alert(1)</script></p>" },
  });
  const frames = out.match(/<iframe[^>]*>/g) ?? [];
  assert.equal(frames.length, 1);
  assert.match(frames[0], /\ssandbox=""/, "the sandbox attribute is present and empty");
  assert.doesNotMatch(frames[0], /allow-/, "no sandbox permission");
  assert.match(frames[0], /\ssrcdoc="&lt;p&gt;Hi &lt;script&gt;/i, "the email goes in srcdoc, escaped as an attribute");
  assert.doesNotMatch(frames[0], /\ssrc=/, "no src or blob URL");
  assert.match(frames[0], /title="Preview: Booking confirmation email"/);
  assert.doesNotMatch(out.replace(frames[0], ""), /<script|<p>Hi/, "the email HTML never lands in the admin page itself");
  assert.match(out, /Booking received/);
  assert.match(out, /Hello &lt;b&gt;there&lt;\/b&gt;/, "the text version is plain text");
  assert.match(out, /Sample booking, not a real customer\./);
});

test("the turn notice is plain text only: no frame", () => {
  const out = html(EmailPreviewView, { label: "Turn notice", preview: { kind: "turn_notice", subject: "Your turn", text: "Bring the car in.", html: null } });
  assert.doesNotMatch(out, /<iframe/);
  assert.match(out, /Bring the car in\./);
  assert.match(out, /This email is sent as plain text\./);
});

test("the test email has no address field, and the source never injects HTML", () => {
  const out = html(EmailTools, { busy: false, onSendTest: async () => undefined });
  assert.match(out, /Send a test email/);
  assert.match(out, /Goes to the shop inbox only\./);
  assert.doesNotMatch(out, /<input/, "no address or other input; the preview choice is a select");
  // Polish 2026-11-25: the visible label wraps the select, so the choice has a real accessible name.
  assert.match(out, /<label[^>]*>Email to preview<span[^>]*><select/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|innerHTML|allow-same-origin|allow-scripts/);
});

// Ported from the draft's settings-mount test: one write at a time across the Settings page.
test("test email is disabled while the settings page writes", () => {
  const out = html(EmailTools, { busy: true, onSendTest: async () => undefined });
  assert.match(out, /<button[^>]*disabled=""[^>]*>Send a test email<\/button>/);
});

// 2026-11-25 card layout: each tool is its own Settings card; the send result shows in the test card's footer strip.
test("email tools are two Settings cards, and the test card's footer shows the result it is given", () => {
  const out = html(EmailTools, { busy: false, onSendTest: async () => undefined, testResult: "Test email sent." });
  assert.match(out, /<h3[^>]*>Send a test email<\/h3>/);
  assert.match(out, /<h3[^>]*>Preview an email<\/h3>/);
  const footer = out.split("data-settings-card-footer")[1] ?? "";
  assert.match(footer, /Test email sent\./);
  assert.match(footer, /Goes to the shop inbox only\./, "the note stays under the result");
});
