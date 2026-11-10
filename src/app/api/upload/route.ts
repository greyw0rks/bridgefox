import { authorize, errorResponse } from "@/lib/http";
import { createUploadUrl } from "@/lib/cloud-store";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try { authorize(request); return Response.json({ uploadUrl: await createUploadUrl() }); }
  catch (error) { return errorResponse(error); }
}
