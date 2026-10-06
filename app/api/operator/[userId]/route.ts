import { requireOperator } from "@/lib/operations";
import { callSmsFunction } from "@/lib/sms";
export async function GET(_request: Request, context: { params: Promise<{ userId: string }> }) {
  try { await requireOperator(); } catch { return Response.json({ error: "Forbidden" }, { status: 403 }); }
  const { userId } = await context.params;
  try { return Response.json(await callSmsFunction("/operator", { query: { userId } }), { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "Support state unavailable" }, { status: 503 }); }
}
