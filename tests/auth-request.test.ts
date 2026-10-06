import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthRequestError, readAuthBody } from "../lib/auth-request.ts";

test("auth request limit rejects declared oversize before reading", async () => {
  await assert.rejects(readAuthBody(new Request("https://mio.test", {
    method: "POST", headers: { "content-length": "20000" }, body: "small",
  })), (error: unknown) => error instanceof AuthRequestError && error.status === 413);
});

test("auth request limit measures streamed bytes without content-length", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(16_385)); },
    cancel() { cancelled = true; },
  });
  const request = new Request("https://mio.test", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  await assert.rejects(readAuthBody(request), AuthRequestError);
  assert.equal(cancelled, true);
});

test("auth body preserves multibyte text and accepts empty signout body", async () => {
  const body = JSON.stringify({ name: "José", password: "安全password" });
  assert.equal(await readAuthBody(new Request("https://mio.test", { method: "POST", body })), body);
  assert.equal(await readAuthBody(new Request("https://mio.test", { method: "POST" })), "");
});
