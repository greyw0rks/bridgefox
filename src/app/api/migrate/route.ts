import { validateProject } from "@/lib/archive";
import { authorize, errorResponse, readJson } from "@/lib/http";
import { migrate } from "@/lib/migrate";
import { z } from "zod";
import { editorProject, loadProject } from "@/lib/project-store";
import { migrationResponse } from "@/lib/migration-stream";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    authorize(request);
    const body = z.union([z.object({ project: z.unknown(), mode: z.enum(["local", "otari"]) }).strict(), z.object({ projectId: z.uuid(), mode: z.enum(["local", "otari"]) }).strict()]).parse(await readJson(request));
    if (body.mode === "otari") authorize(request, true);
    const project = "projectId" in body ? await loadProject(body.projectId) : validateProject(body.project);
    return migrationResponse(async (emit, signal) => {
      const result = await migrate(project, body.mode, emit, signal);
      return "projectId" in body ? { ...result, project: editorProject(result.project) } : result;
    }, request.signal);
  } catch (error) { return errorResponse(error); }
}
