import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { LIMITS } from "./archive";

export function authorize(request: Request) {
  const expected = process.env.BRIDGEFOX_ACCESS_TOKEN;
  if (expected) {
    const supplied = request.headers.get("x-bridgefox-access") ?? "";
    if (!timingSafeEqual(createHash("sha256").update(supplied).digest(), createHash("sha256").update(expected).digest())) throw new HttpError(401, "Enter the workspace access password");
  } else {
    // A publicly exposed process must be explicitly protected, including its AI budget.
    const host = new URL(request.url).hostname;
    if (!["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(host) && !host.endsWith(".localhost")) throw new HttpError(503, "Set BRIDGEFOX_ACCESS_TOKEN before exposing this workspace publicly");
  }
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).origin !== new URL(request.url).origin) throw new HttpError(403, "Cross-origin requests are not allowed");
}
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function boundedBody(request: Request, limit = LIMITS.request): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > limit) throw new HttpError(413, "Request exceeds upload limits");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Request body is required");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) { await reader.cancel(); throw new HttpError(413, "Request exceeds upload limits"); }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return body;
}
export async function readJson(request: Request): Promise<unknown> {
  try { return JSON.parse(new TextDecoder().decode(await boundedBody(request))); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, "Request must contain valid JSON"); }
}
export function errorResponse(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  const message = error instanceof z.ZodError ? "The extension or patch data is invalid" : error instanceof Error ? error.message : "Request failed";
  return Response.json({ error: message }, { status });
}
