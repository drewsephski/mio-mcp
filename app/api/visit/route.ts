import { callSmsFunction } from "@/lib/sms";
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(process.env.APP_URL!).origin) return Response.json({ error: "Forbidden" }, { status: 403 });
  try {
    await callSmsFunction("/visit", { body: { surface: "web" } });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Visit could not be recorded" }, { status: 503 }); }
}
