import { z } from "zod";
import { validateProject } from "@/lib/archive";
import { analyze } from "@/lib/analyzer";
import { authorize, errorResponse, readJson } from "@/lib/http";
import { editorProject, recalledProject, rememberProject } from "@/lib/project-store";

export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    authorize(request);
    const body = z.union([
      z.object({ project: z.unknown() }).strict(),
      z.object({ projectId: z.uuid(), manifestPath: z.string() }).strict(),
    ]).parse(await readJson(request));
    let project;
    if ("projectId" in body) {
      const original = recalledProject(body.projectId);
      const manifest = original.files.find(file => file.path === body.manifestPath && file.encoding === "utf8");
      if (!original.source?.manifestCandidates.includes(body.manifestPath) || !manifest) throw new Error("Choose a source manifest from this repository");
      project = validateProject({ ...original, source: { ...original.source, manifestPath: body.manifestPath }, files: original.files.map(file => file.path === "manifest.json" ? { ...file, content: manifest.content } : file) });
    } else project = validateProject(body.project);
    const report = analyze(project);
    return Response.json({ projectId: rememberProject(project, "projectId" in body ? body.projectId : undefined), project: editorProject(project), report });
  } catch (error) { return errorResponse(error); }
}
