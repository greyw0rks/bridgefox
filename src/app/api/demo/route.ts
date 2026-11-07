import { DEMO } from "@/lib/demo";
import { analyze } from "@/lib/analyzer";
import { authorize, errorResponse } from "@/lib/http";
import { editorProject, rememberProject } from "@/lib/project-store";
export async function POST(request: Request) {
  try { authorize(request); return Response.json({ projectId: rememberProject(DEMO), project: editorProject(DEMO), report: analyze(DEMO) }); }
  catch (error) { return errorResponse(error); }
}
