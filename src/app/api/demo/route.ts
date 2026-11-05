import { DEMO } from "@/lib/demo";
import { analyze } from "@/lib/analyzer";
import { authorize, errorResponse } from "@/lib/http";
export async function POST(request: Request) {
  try { authorize(request); return Response.json({ project: DEMO, report: analyze(DEMO) }); }
  catch (error) { return errorResponse(error); }
}
