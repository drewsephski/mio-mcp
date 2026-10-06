import { z } from "zod";

export function inviteEmails(value: string | undefined) {
  return (value ?? "").split(",").map(email => email.trim().toLowerCase()).filter(Boolean).map(email => z.email().parse(email));
}
export function hasBetaAccess(email: string, invitedEmails?: readonly string[]) {
  return invitedEmails === undefined || invitedEmails.includes(email.trim().toLowerCase());
}

// An allowlisted address is an invitation, not proof that the account owns it.
// The factory's undefined policy remains available for isolated legacy tests;
// production always supplies a list, including an empty closed list.
export function hasVerifiedBetaAccess(user: { email: string; emailVerification?: boolean }, invitedEmails?: readonly string[]) {
  return invitedEmails === undefined || (user.emailVerification === true && hasBetaAccess(user.email, invitedEmails));
}
