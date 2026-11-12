import assert from "node:assert/strict";
import { test } from "node:test";
import { customerEmailHtml } from "./email-layout";

test("customer emails show the shop logo from the site and escape every booking value", () => {
  const html = customerEmailHtml({
    origin: "https://shop.example.test", preheader: "p", heading: "Booking received", intro: "Thanks",
    booking: { referenceCode: "ZEUS-1", bookingDate: "2026-11-13", vehicleCategoryName: "Small", estimatedTotalCentavos: 1750000,
      lines: [{ name: "<script>alert(1)</script>", quantity: 2, priceStatus: "FOR_QUOTE" }] } as never,
    button: { label: "Track your booking", href: "https://shop.example.test/book/manage" },
  });
  assert.match(html, /<img src="https:\/\/shop\.example\.test\/images\/logo-light\.png"/);
  assert.ok(!html.includes("<script>"), "a service name cannot inject markup");
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /PHP 17,500\.00/);
  assert.match(html, /For quote/);
  assert.match(html, /href="https:\/\/shop\.example\.test\/book\/manage"/);
});
