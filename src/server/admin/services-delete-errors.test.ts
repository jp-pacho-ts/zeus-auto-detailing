import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { serviceDeleteFailure } from "./services";

test("delete errors use structured SQLSTATE even when Prisma includes other codes in a source excerpt", () => {
  const message = 'Invalid invocation: if (text.includes("ZT004")) ... ZT001 ... ZT003';
  for (const [sqlState, expected] of [["ZT003", "NOT_ALLOWED"], ["ZT001", "NOT_FOUND"], ["ZT004", "FORBIDDEN"], ["ZT006", "VALIDATION_ERROR"]]) {
    const error = new Prisma.PrismaClientKnownRequestError(message, { code: "P2010", clientVersion: "6.4.1", meta: { code: sqlState } });
    assert.equal(serviceDeleteFailure(error)?.adminCode, expected);
  }
  assert.equal(serviceDeleteFailure(new Error(message)), null);
});
