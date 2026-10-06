import test from "node:test";
import assert from "node:assert/strict";
import { operatorPageDenied } from "../scripts/release/page-denial.mjs";

test("operator page acceptance recognizes streamed denial without accepting private content", () => {
  assert.equal(operatorPageDenied(404, "Page not found"), true);
  assert.equal(operatorPageDenied(200, "Loading… Page not found"), true);
  assert.equal(operatorPageDenied(200, "Loading…"), false);
  assert.equal(operatorPageDenied(200, "Page not found Aggregate infrastructure data"), false);
  assert.equal(operatorPageDenied(404, "Page not found Admitted users"), false);
  assert.equal(operatorPageDenied(500, "Page not found"), false);
});
