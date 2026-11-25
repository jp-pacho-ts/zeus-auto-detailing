import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ExpenseMonthSchema } from './admin-validation';
test('expense list accepts a complete bounded range and refuses partial or reversed ranges', () => {
  assert.equal(ExpenseMonthSchema.safeParse({month:'2026-11',from:'2026-01-01',to:'2026-12-31'}).success,true);
  for (const range of [{from:'2026-11-01'}, {from:'2026-11-20',to:'2026-11-01'}, {from:'2025-01-01',to:'2026-12-31'}]) assert.equal(ExpenseMonthSchema.safeParse({month:'2026-11',...range}).success,false);
});
