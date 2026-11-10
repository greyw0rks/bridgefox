import { importZip, LIMITS } from "@/lib/archive";
import { analyze } from "@/lib/analyzer";
import { authorize, boundedBody, errorResponse, readJson, streamedJson } from "@/lib/http";
import { editorProject, saveProject } from "@/lib/project-store";
import { readUploadedArchive, removeStoredFile } from "@/lib/cloud-store";
import { z } from "zod";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    authorize(request);
    let bytes: Uint8Array;
    let name: string;
    if (request.headers.get("content-type")?.startsWith("application/json")) {
      const body = z.object({ storageId: z.string().min(1).max(128), name: z.string().min(1).max(255).refine(name => name.toLowerCase().endsWith(".zip")) }).strict().parse(await readJson(request));
      try { bytes = await readUploadedArchive(body.storageId); }
      finally { await removeStoredFile(body.storageId).catch(() => {}); }
      name = body.name;
    } else {
      const multipart = await boundedBody(request, LIMITS.upload + 128 * 1024);
      const form = await new Response(multipart as BodyInit, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
      const file = form.get("file");
      if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".zip")) throw new Error("Upload extension source as a .zip file");
      bytes = new Uint8Array(await file.arrayBuffer()); name = file.name;
    }
    const project = await importZip(Buffer.from(bytes), name);
    const report = analyze(project);
    return streamedJson({ projectId: await saveProject(project), project: editorProject(project), report });
  } catch (error) { return errorResponse(error); }
}
