import { release } from "@/functions/mio-sms/src/release.generated";
import { validOperationsToken } from "@/functions/mio-sms/src/readiness";

export async function GET(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!validOperationsToken(token, process.env.MIO_OPERATIONS_TOKEN)) return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const url = new URL("/ready", process.env.MIO_SMS_WEBHOOK_URL);
    const response = await fetch(url, { headers: { "x-mio-operations-token": token! }, cache: "no-store", signal: AbortSignal.timeout(20_000), redirect: "error" });
    if (!response.ok) throw new Error("Function not ready");
    const fn = await response.json();
    const ready = fn.ready === true && fn.releaseId === release.releaseId && fn.schemaVersion === release.schemaVersion && fn.schemaDigest === release.schemaDigest;
    return Response.json({ ...release, ready, function: fn }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ...release, ready: false, error: "Function readiness unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
