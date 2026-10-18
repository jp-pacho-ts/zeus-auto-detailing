import assert from "node:assert/strict";
import {test} from "node:test";
import {pendingAlertLevel} from "./bookings-alerts";
test("PENDING alerts use 14 Manila calendar days across UTC midnight and strict cap-share thresholds",()=>{
 for(const now of [new Date("2026-10-18T16:30:00Z"),new Date("2026-10-19T00:30:00Z")]){
  assert.equal(pendingAlertLevel("2026-10-19",now,6,10),null);
  assert.equal(pendingAlertLevel("2026-11-01",now,7,10),"WARN");
  assert.equal(pendingAlertLevel("2026-11-01",now,9,10),"INCIDENT");
  assert.equal(pendingAlertLevel("2026-11-02",now,9,10),null);
  assert.equal(pendingAlertLevel("2026-10-18",now,9,10),null);
  assert.equal(pendingAlertLevel("2026-10-19",now,1,0),null);
 }
});
