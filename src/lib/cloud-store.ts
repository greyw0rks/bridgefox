import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { HttpError, boundedBody } from "./http";
import { LIMITS } from "./limits";

export function cloudConfigured() { return Boolean(process.env.CONVEX_URL && process.env.BRIDGEFOX_STORAGE_SECRET); }
function client() {
  if (!cloudConfigured()) throw new HttpError(503, "Configure shared project storage first");
  return new ConvexHttpClient(process.env.CONVEX_URL!);
}
async function call(name: string, args: Record<string, unknown> = {}) {
  return await client().mutation(makeFunctionReference<"mutation">(`projects:${name}`), { secret: process.env.BRIDGEFOX_STORAGE_SECRET!, ...args });
}
export async function createUploadUrl(): Promise<string> { return await call("uploadUrl"); }
export async function uploadStoredFile(bytes: Uint8Array, type: string): Promise<string> {
  const response = await fetch(await createUploadUrl(), { method: "POST", headers: { "Content-Type": type }, body: bytes as BodyInit, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error("Shared storage upload failed");
  return (await response.json()).storageId;
}
export async function storedFileUrl(storageId: string, maxBytes: number): Promise<string> { return await call("uploadedFile", { storageId, maxBytes }); }
export async function removeStoredFile(storageId: string) { await call("removeFile", { storageId }); }
export async function registerStoredProject(projectId: string, storageId: string, bytes: number) { await call("register", { projectId, storageId, bytes }); }
export async function storedProjectUrl(projectId: string): Promise<string | null> { return await call("recall", { projectId }); }
export async function readUploadedArchive(storageId: string): Promise<Uint8Array> {
  const response = await fetch(await storedFileUrl(storageId, LIMITS.upload), { cache: "no-store", signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error("Could not read the uploaded source ZIP");
  return await boundedBody(new Request("https://storage.invalid", { method: "POST", body: response.body, duplex: "half", headers: response.headers } as RequestInit), LIMITS.upload);
}
