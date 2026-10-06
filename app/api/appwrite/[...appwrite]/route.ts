import { createAppwriteHandlers } from "@appwrite.io/react/handlers/next";
import { getServerAppwriteConfig } from "@/lib/config";
import { z } from "zod";
import { inviteEmails } from "@/functions/mio-sms/src/beta";
import { AuthRequestError, readAuthBody, requireInvitedSignup } from "@/lib/auth-request";

const handlers = createAppwriteHandlers({
  ...getServerAppwriteConfig(),
  basePath: "/api/appwrite",
  redirects: { success: "/today", failure: "/auth" },
});

export const GET = handlers.GET;

export async function POST(request: Request) {
  const appOrigin = new URL(z.url().parse(process.env.APP_URL)).origin;
  if (request.headers.get("origin") !== appOrigin) {
    return Response.json({ message: "This request must come from Mio." }, { status: 403 });
  }
  try {
    const body = await readAuthBody(request);
    if (new URL(request.url).pathname.replace(/\/+$/, "").endsWith("/sign-up/email-password")) {
      requireInvitedSignup(body, inviteEmails(process.env.MIO_INVITE_EMAILS));
    }
    return handlers.POST(new Request(request.url, {
      method: "POST", headers: request.headers, body: body || undefined,
    }));
  } catch (error) {
    if (error instanceof AuthRequestError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
