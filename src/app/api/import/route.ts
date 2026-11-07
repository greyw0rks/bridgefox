import { importZip, LIMITS } from "@/lib/archive";
import { analyze } from "@/lib/analyzer";
import { authorize, boundedBody, errorResponse } from "@/lib/http";
import { editorProject, rememberProject } from "@/lib/project-store";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    authorize(request);
    const bytes = await boundedBody(request, LIMITS.upload + 128 * 1024);
    const form = await new Response(bytes as BodyInit, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".zip")) throw new Error("Upload extension source as a .zip file");
    const project = await importZip(Buffer.from(await file.arrayBuffer()), file.name);
    const report = analyze(project);
    return Response.json({ projectId: rememberProject(project), project: editorProject(project), report });
  } catch (error) { return errorResponse(error); }
}
