import assert from "node:assert/strict";
import { test } from "node:test";
import { notificationConfiguration, sendSmtpMessage } from "./bookings";
import { smtpSimulation } from "./smtp.fixture";

test("SMTP environment pins Gmail, TLS modes and verified configuration", () => {
  const base = {
    SMTP_HOST: "smtp.gmail.com",
    SMTP_PORT: "465",
    SMTP_USER: "dedicated@gmail.com",
    SMTP_APP_PASSWORD: "synthetic-password",
    SMTP_FROM: "dedicated@gmail.com",
    SMTP_SHOP_NOTIFY_EMAIL: "shop@example.test",
    APP_ORIGIN: "https://zeus.example.test",
  };
  assert.ok(notificationConfiguration(base));
  assert.equal(notificationConfiguration(base)!.secure, true);
  assert.equal(
    notificationConfiguration({ ...base, SMTP_PORT: "587" })!.secure,
    false,
  );
  for (const extra of [
    { SMTP_HOST: "evil.test" },
    { SMTP_PORT: "25" },
    { SMTP_APP_PASSWORD: "" },
    { SMTP_FROM: "bad\r\nBcc: leaked@example.test" },
    { SMTP_USER: "not-an-email" },
  ])
    assert.equal(notificationConfiguration({ ...base, ...extra }), null);
});
test("real SMTP transport succeeds on verified implicit TLS and mandatory STARTTLS", async () => {
  for (const mode of ["TLS", "STARTTLS"] as const) {
    const smtp = await smtpSimulation(mode);
    try {
      assert.equal(
        await sendSmtpMessage(
          smtp.config,
          "recipient@example.test",
          { subject: "Synthetic notice", text: "Fixed synthetic text" },
          "<booking-shop.synthetic@localhost>",
        ),
        true,
      );
      assert.ok(smtp.commands.includes("AUTH"), "SMTP authenticates after TLS");
      assert.equal(smtp.messages.length, 1);
      assert.equal(
        smtp.messages[0].messageId,
        "<booking-shop.synthetic@localhost>",
      );
      assert.equal(smtp.messages[0].text, "Fixed synthetic text");
      assert.equal(smtp.messages[0].to, "recipient@example.test");
    } finally {
      await smtp.close();
    }
  }
});
test("SMTP fails closed without TLS, for untrusted certificate, rejection and bounded hanging peer", async () => {
  const plain = await smtpSimulation("PLAIN");
  try {
    assert.equal(
      await sendSmtpMessage(
        plain.config,
        "recipient@example.test",
        { subject: "x", text: "x" },
        "<x@localhost>",
      ),
      false,
    );
    assert.equal(plain.commands.includes("AUTH"), false);
    assert.equal(plain.messages.length, 0);
  } finally {
    await plain.close();
  }
  const smtp = await smtpSimulation();
  try {
    assert.equal(
      await sendSmtpMessage(
        { ...smtp.config, ca: undefined },
        "recipient@example.test",
        { subject: "x", text: "x" },
        "<x@localhost>",
      ),
      false,
    );
    assert.equal(smtp.messages.length, 0);
    smtp.setRejected(true);
    assert.equal(
      await sendSmtpMessage(
        smtp.config,
        "recipient@example.test",
        { subject: "x", text: "x" },
        "<x@localhost>",
      ),
      false,
    );
    smtp.setRejected(false);
    smtp.setHanging(true);
    const start = Date.now();
    assert.equal(
      await sendSmtpMessage(
        smtp.config,
        "recipient@example.test",
        { subject: "x", text: "x" },
        "<x@localhost>",
      ),
      false,
    );
    assert.ok(Date.now() - start < 5000, "bounded SMTP operation");
  } finally {
    await smtp.close();
  }
});
test("SMTP rejects a trusted certificate with the wrong host identity", async () => {
  const smtp = await smtpSimulation("TLS", "wrong-host.example.test");
  try {
    assert.equal(
      await sendSmtpMessage(
        smtp.config,
        "recipient@example.test",
        { subject: "x", text: "x" },
        "<x@localhost>",
      ),
      false,
    );
    assert.equal(smtp.commands.includes("AUTH"), false);
    assert.equal(smtp.messages.length, 0);
  } finally {
    await smtp.close();
  }
});
