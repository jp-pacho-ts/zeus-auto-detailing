// P1-73 (Security N1): the privacy check for the HTML part of a customer email. Test-only.
import assert from "node:assert/strict";

// Staff field names the booking receipt test already bans (bookings-create noPrivate), plus its staff-reason canary.
const STAFF_ONLY = ["CANARY STAFF REASON", "remainingCapacity", "dailyCap", "queuePosition", "bayCapacityRequired", "customerPhone", "customerEmail"];

export function assertCustomerHtmlPrivate(html: string, reference: string, privateValues: string[], label: string): void {
  // The part must exist and be decoded, or every check below passes on an empty string.
  assert.ok(html.includes(reference), label + ": the HTML part is decoded and shows the reference");
  for (const value of [...privateValues, ...STAFF_ONLY]) {
    assert.ok(value.length > 0, label + ": an empty private value would match nothing");
    assert.equal(html.includes(value), false, label + ": the HTML part leaks " + JSON.stringify(value));
  }
  assert.doesNotMatch(html, /\/admin\b|accessToken|\b(?:bays?|capacity|workers?)\b/i, label + ": the HTML part shows staff-only text");
}
