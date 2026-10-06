import assert from "node:assert/strict";
import { test } from "node:test";
import { inviteEmails, hasBetaAccess, hasVerifiedBetaAccess } from "../functions/mio-sms/src/beta.ts";
import { assertOutsideQuietHours, quietHoursSchema } from "../functions/mio-sms/src/preferences.ts";

test("beta access fails closed and compares exact normalized emails", () => {
  assert.equal(hasBetaAccess("drew@example.com", inviteEmails(undefined)), false);
  const allowed = inviteEmails(" Drew@Example.com,friend@example.com ");
  assert.equal(hasBetaAccess("DREW@example.com", allowed), true);
  assert.equal(hasBetaAccess("drew+spam@example.com", allowed), false);
  assert.throws(() => inviteEmails("anything"));
});
test("an invitation requires verified email ownership, including after an email change", () => {
  const allowed = inviteEmails("drew@example.com");
  assert.equal(hasVerifiedBetaAccess({ email: "drew@example.com", emailVerification: false }, allowed), false);
  assert.equal(hasVerifiedBetaAccess({ email: "drew@example.com" }, allowed), false);
  assert.equal(hasVerifiedBetaAccess({ email: "DREW@example.com", emailVerification: true }, allowed), true);
  assert.equal(hasVerifiedBetaAccess({ email: "other@example.com", emailVerification: true }, allowed), false);
  assert.equal(hasVerifiedBetaAccess({ email: "drew@example.com", emailVerification: true }, []), false);
});
test("quiet hours handle overnight, boundary, timezone and invalid pairs", () => {
  const quiet = { quietHoursStart: "22:00", quietHoursEnd: "07:00" };
  assert.throws(() => assertOutsideQuietHours("2026-10-07T03:00:00Z", "America/Chicago", quiet));
  assert.doesNotThrow(() => assertOutsideQuietHours("2026-10-07T12:00:00Z", "America/Chicago", quiet));
  assert.throws(() => quietHoursSchema.parse({ quietHoursStart: "22:00", quietHoursEnd: "" }));
  assert.throws(() => quietHoursSchema.parse({ quietHoursStart: "22:00", quietHoursEnd: "22:00" }));
  assert.doesNotThrow(() => assertOutsideQuietHours("2026-10-07T03:00:00Z", "America/Chicago", {}));
});
