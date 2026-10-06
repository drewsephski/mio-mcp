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
