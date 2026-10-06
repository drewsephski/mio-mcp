import { createAppwriteHandlers } from "@appwrite.io/react/handlers/next";
import { getServerAppwriteConfig } from "@/lib/config";
import { z } from "zod";
import { AppwriteException, Client, ID, Users } from "node-appwrite";
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
      const signup = z.object({ email: z.email(), password: z.string().min(8).max(256), name: z.string().max(128).optional() }).parse(JSON.parse(body));
      const config = getServerAppwriteConfig();
      // Users API deliberately bypasses the public Account creation limit.
      // Caller-supplied userId/labels/verification are never forwarded.
      await new Users(new Client().setEndpoint(config.endpoint).setProject(config.projectId).setKey(config.apiKey)).create({ userId: ID.unique(), ...signup });
      return handlers.POST(new Request(new URL("/api/appwrite/sign-in/email-password", request.url), { method: "POST", headers: request.headers, body: JSON.stringify(signup) }));
    }
    return handlers.POST(new Request(request.url, {
      method: "POST", headers: request.headers, body: body || undefined,
    }));
  } catch (error) {
    if (error instanceof AuthRequestError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) return Response.json({ error: "Enter valid account details." }, { status: 400 });
    if (error instanceof AppwriteException) return Response.json({ error: "Account creation could not be confirmed. Try signing in or resetting your password." }, { status: [400, 409, 429].includes(error.code) ? error.code : 503 });
    throw error;
  }
}
