"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { Account, AppwriteException, Client } from "node-appwrite";
import { z } from "zod";
import { getAppwriteHelpers } from "@/lib/appwrite";
import { getPublicAppwriteConfig } from "@/lib/config";

export type AccountActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

const tokenSchema = z.object({
  userId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/),
  secret: z.string().min(1).max(4096).regex(/^[^\s\u0000-\u001f\u007f]+$/),
});
const recoverySchema = z.object({ email: z.email().max(320) });
const passwordSchema = tokenSchema.extend({
  password: z.string().min(8).max(256),
  confirmation: z.string(),
}).refine((value) => value.password === value.confirmation, {
  message: "Passwords must match.",
});

function callbackUrl(path: string) {
  const appUrl = z.url().parse(process.env.APP_URL);
  const url = new URL(appUrl);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) {
    throw new Error("APP_URL must use HTTPS, or HTTP on localhost.");
  }
  if (url.username || url.password) throw new Error("APP_URL must not contain credentials.");
  return new URL(path, url.origin).toString();
}

async function publicAccount() {
  const { endpoint, projectId } = getPublicAppwriteConfig();
  const client = new Client().setEndpoint(endpoint).setProject(projectId);
  const userAgent = (await headers()).get("user-agent");
  if (userAgent) client.setForwardedUserAgent(userAgent);
  return new Account(client);
}

function accountError(error: unknown, fallback: string): AccountActionResult {
  if (error instanceof AppwriteException) {
    if (error.code === 429) return { ok: false, message: "Too many requests. Wait a few minutes, then try again." };
    if (error.type === "user_password_history" || error.type === "user_password_personal_data") {
      return { ok: false, message: "Choose a different password that you have not used before and does not contain personal details." };
    }
    if (error.type === "password_recently_used" || error.type === "general_password_invalid") {
      return { ok: false, message: "Choose a stronger password, between 8 and 256 characters." };
    }
  }
  return { ok: false, message: fallback };
}

export async function requestPasswordRecovery(formData: FormData): Promise<AccountActionResult> {
  const input = recoverySchema.safeParse({ email: String(formData.get("email") ?? "").trim() });
  if (!input.success) return { ok: false, message: "Enter a valid email address." };
  try {
    const account = await publicAccount();
    await account.createRecovery({ email: input.data.email, url: callbackUrl("/auth/reset-password") });
  } catch (error) {
    // Unknown accounts receive the same response as existing accounts.
    if (!(error instanceof AppwriteException && error.type === "user_not_found")) {
      return accountError(error, "We could not send a reset link. Please try again later.");
    }
  }
  return { ok: true, message: "If an account exists for that email, a reset link is on its way. Check your inbox and spam folder." };
}

export async function resetPassword(formData: FormData): Promise<AccountActionResult> {
  const input = passwordSchema.safeParse({
    userId: formData.get("userId"), secret: formData.get("secret"),
    password: formData.get("password"), confirmation: formData.get("confirmation"),
  });
  if (!input.success) return { ok: false, message: "Use a valid reset link and matching passwords between 8 and 256 characters." };
  try {
    const account = await publicAccount();
    await account.updateRecovery({ userId: input.data.userId, secret: input.data.secret, password: input.data.password });
    return { ok: true, message: "Your password has been updated. Sign in with your new password." };
  } catch (error) {
    return accountError(error, "This reset link may have expired or already been used. Request a new link and try again.");
  }
}

export async function sendEmailVerification(): Promise<AccountActionResult> {
  try {
    const session = await getAppwriteHelpers().createSessionClient();
    if (!session) return { ok: false, message: "Please sign in to verify your email." };
    const user = await session.account.get();
    if (user.emailVerification) return { ok: true, message: "Your email address is already verified." };
    await session.account.createVerification({ url: callbackUrl("/auth/verify") });
    return { ok: true, message: "Verification link sent. Check your inbox and spam folder." };
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 401) return { ok: false, message: "Your session expired. Please sign in again." };
    return accountError(error, "We could not send a verification link. Please try again later.");
  }
}

export async function verifyEmail(formData: FormData): Promise<AccountActionResult> {
  const input = tokenSchema.safeParse({ userId: formData.get("userId"), secret: formData.get("secret") });
  if (!input.success) return { ok: false, message: "Open the complete verification link from your email." };
  try {
    const account = await publicAccount();
    await account.updateEmailVerification(input.data);
    revalidatePath("/dashboard");
    revalidatePath("/onboarding");
    return { ok: true, message: "Your email address is verified." };
  } catch (error) {
    return accountError(error, "This verification link may have expired or already been used. Sign in and request a new link.");
  }
}
