import assert from "node:assert/strict";
import {test} from "node:test";
import {pendingAlertLevel} from "./bookings-alerts";
test("PENDING count alerts use 14 Manila calendar days and strictly exceed configured threshold",()=>{
 for(const now of [new Date("2026-10-18T16:30:00Z"),new Date("2026-10-19T00:30:00Z")]){
  assert.equal(pendingAlertLevel("2026-10-19",now,20),null);
  assert.equal(pendingAlertLevel("2026-11-01",now,21),"WARN");
  assert.equal(pendingAlertLevel("2026-11-02",now,100),null);
  assert.equal(pendingAlertLevel("2026-10-18",now,100),null);
  assert.equal(pendingAlertLevel("2026-10-19",now,3,3),null);
  assert.equal(pendingAlertLevel("2026-10-19",now,4,3),"WARN");
 }
});
