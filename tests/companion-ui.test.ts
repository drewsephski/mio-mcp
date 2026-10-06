import assert from "node:assert/strict";
import { test } from "node:test";
import { localDateTime } from "../lib/companion-models.ts";

test("reminder editing uses the reminder timezone instead of the server timezone", () => {
  assert.equal(localDateTime("2026-10-06T15:30:00.000Z", "America/Chicago"), "2026-10-06T10:30");
  assert.equal(localDateTime("2026-10-06T15:30:00.000Z", "Asia/Tokyo"), "2026-10-07T00:30");
});

test("reminder editing respects daylight saving changes", () => {
  assert.equal(localDateTime("2026-03-08T07:30:00.000Z", "America/Chicago"), "2026-03-08T01:30");
  assert.equal(localDateTime("2026-03-08T08:30:00.000Z", "America/Chicago"), "2026-03-08T03:30");
});
