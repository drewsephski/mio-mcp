const MAX_AUTH_BODY_BYTES = 16_384;

export class AuthRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function readAuthBody(request: Request): Promise<string> {
  if (Number(request.headers.get("content-length")) > MAX_AUTH_BODY_BYTES) {
    throw new AuthRequestError("This request is too large.", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUTH_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        throw new AuthRequestError("This request is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export function requireInvitedSignup(body: string, allowedEmails: readonly string[]) {
  let email: unknown;
  try { email = (JSON.parse(body) as { email?: unknown }).email; }
  catch { throw new AuthRequestError("Enter a valid email address.", 400); }
  if (typeof email !== "string" || !allowedEmails.includes(email.trim().toLowerCase())) {
    throw new AuthRequestError("Mio is in an invite-only beta. Sign up with your invited email address.", 403);
  }
}
