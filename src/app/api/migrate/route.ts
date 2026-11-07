import { validateProject } from "@/lib/archive";
import { authorize, errorResponse, readJson } from "@/lib/http";
import { migrate } from "@/lib/migrate";
import { z } from "zod";
import { editorProject, recalledProject } from "@/lib/project-store";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    authorize(request);
    const body = z.union([z.object({ project: z.unknown(), mode: z.enum(["local", "otari"]) }).strict(), z.object({ projectId: z.uuid(), mode: z.enum(["local", "otari"]) }).strict()]).parse(await readJson(request));
    const project = "projectId" in body ? recalledProject(body.projectId) : validateProject(body.project);
    const abort = new AbortController();
    request.signal.addEventListener("abort", () => abort.abort(), { once: true });
    const encoder = new TextEncoder();
    let closed = false;
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (event: unknown) => { if (!closed) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); };
        try { const result = await migrate(project, body.mode, emit, abort.signal); emit({ type: "result", result: "projectId" in body ? { ...result, project: editorProject(result.project) } : result }); }
        catch (error) { emit({ type: "error", message: error instanceof Error ? error.message : "Migration failed" }); }
        finally { if (!closed) { closed = true; controller.close(); } }
      },
      cancel() { closed = true; abort.abort(); }
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  } catch (error) { return errorResponse(error); }
}
