// P1-32: the pure rules of the "reference code + last name" lookup.
import assert from "node:assert/strict";
import { test } from "node:test";
import { composeCustomerName, lastNameFallback, lastNamesMatch, maskEmail, maskPhone, normalizeLastName, normalizeReference, progressFor } from "./booking-lookup";

test("P1-32: a last name is compared without case, accents, spacing, hyphens, apostrophes or dots", () => {
  const same = [["Cruz", "cruz"], ["Cruz", " CRUZ "], ["De la Cruz", "dela cruz"], ["De la Cruz", "dé  la CRUZ"], ["de-la-cruz", "De La Cruz"],
    ["O'Brien", "obrien"], ["O’Brien", "O'Brien"], ["Peña", "Pena"], ["Muñoz", "MUNOZ"], ["Dela Cruz Jr.", "delacruzjr"], ["Zoë", "zoe"]];
  for (const [a, b] of same) assert.ok(lastNamesMatch(a, b), `${a} / ${b}`);
  const different = [["Cruz", "Cruzz"], ["Cruz", "Reyes"], ["Cruz", ""], ["", ""], ["Cruz", "Cruz Santos"], ["Li", "Lee"]];
  for (const [a, b] of different) assert.equal(lastNamesMatch(a, b), false, `${a} / ${b}`);
  assert.equal(normalizeLastName("  Ñandú-Ríos "), "nanduríos".normalize("NFD").replace(/\p{M}/gu, ""));
});

test("P1-32: an empty or blank last name never matches, even against an empty stored name", () => {
  assert.equal(lastNamesMatch("", ""), false);
  assert.equal(lastNamesMatch("   ", "-- ."), false);
  assert.equal(lastNamesMatch(null, "Cruz"), false);
});

test("P1-32: reference codes are trimmed and upper-cased; anything not shaped like a code is rejected", () => {
  assert.equal(normalizeReference(" zeus-a1b2c3 "), "ZEUS-A1B2C3");
  assert.equal(normalizeReference("ZEUS-Q00004"), "ZEUS-Q00004");
  for (const bad of ["", "ZEUS", "A1B2C3", "ZEUS-", "ZEUS-A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6", "ZEUS-A1 B2C3", "ZEUS-A1B2C3'; DROP", 12 as unknown as string])
    assert.equal(normalizeReference(bad), null, String(bad));
});

test("P1-32: an old single-name booking is matched on its last word, and a one-word name has none", () => {
  assert.equal(lastNameFallback("Juan dela Cruz"), "Cruz");
  assert.equal(lastNameFallback("Maria  Santos "), "Santos");
  assert.equal(lastNameFallback("Cher"), null);
  assert.equal(lastNameFallback(""), null);
});

test("P1-32: the stored display name is First Last, and an old single name is kept as sent", () => {
  assert.equal(composeCustomerName({ customerFirstName: " Ana ", customerLastName: "dela Cruz" }), "Ana dela Cruz");
  assert.equal(composeCustomerName({ customerName: "Old Style Name" }), "Old Style Name");
  assert.equal(composeCustomerName({ customerName: "Old Name", customerFirstName: "New", customerLastName: "Name" }), "New Name");
});

test("P1-32: contact details are masked and never whole", () => {
  assert.equal(maskPhone("+639171234567"), "+63 9•• ••• 4567");
  assert.equal(maskPhone("09171234567"), "+63 9•• ••• 4567");
  assert.equal(maskEmail("juan.delacruz@gmail.com"), "j•••@gmail.com");
  assert.equal(maskEmail(null), null);
  assert.equal(maskEmail("a@b.co"), "a•••@b.co");
  for (const out of [maskPhone("+639171234567"), maskEmail("juan.delacruz@gmail.com") ?? ""]) {
    assert.ok(!out.includes("917123"));
    assert.ok(!out.includes("juan"));
  }
});

test("P1-32: progress is status-level only, in plain words (the 2026-10-21 ruling)", () => {
  assert.deepEqual(progressFor("PENDING"), { label: "Received", step: 1, steps: ["Received", "Confirmed", "In service", "Completed"], cancelled: false });
  assert.deepEqual(progressFor("CONFIRMED").step, 2);
  assert.deepEqual(progressFor("IN_PROGRESS").step, 3);
  assert.deepEqual(progressFor("COMPLETED").step, 4);
  assert.deepEqual(progressFor("CANCELLED"), { label: "Cancelled", step: 0, steps: ["Received", "Confirmed", "In service", "Completed"], cancelled: true });
});

// Codex note (P1-32): only the approved separators are dropped; other symbols must match as typed.
test("P1-32: names match across case, accents, spaces, hyphens, apostrophes and dots, and across nothing else", () => {
  for (const same of [["O'Neil", "o-neil"], ["O'Neil", "O Neil"], ["O'Neil", "o.neil"], ["O'Neil", "ONeil"], ["O'Neil", "O" + String.fromCharCode(0x2019) + "Neil"], ["de la Cruz", "D" + String.fromCharCode(0xc9) + "  LA   cruz"], ["Dela-Cruz", "dela cruz"], [String.fromCharCode(0xd1) + "and" + String.fromCharCode(0xfa), "NANDU"]])
    assert.equal(lastNamesMatch(same[0], same[1]), true, same.join(" vs "));
  for (const different of [["O/Neil", "ONeil"], ["Anne&Marie", "AnneMarie"], ["Smith_Jones", "SmithJones"], ["Cruz+Reyes", "CruzReyes"], ["Cruz", "Cruzz"], ["Santos", "Sant"]])
    assert.equal(lastNamesMatch(different[0], different[1]), false, different.join(" vs "));
  assert.equal(lastNamesMatch("Anne&Marie", "anne & marie"), true, "the same symbol still matches itself, with spacing and case ignored");
  assert.equal(lastNamesMatch("...", "---"), false, "a name that normalizes to nothing never matches");
  assert.equal(normalizeLastName("O/Neil"), "o/neil");
});
