import { z } from "zod";
import { validateProject } from "@/lib/archive";
import { authorize, errorResponse, readJson } from "@/lib/http";
import { exportZip } from "@/lib/export";
import { recalledProject } from "@/lib/project-store";
const patchSchema = z.object({ path: z.string(), before: z.string(), after: z.string(), reason: z.string(), origin: z.enum(["rules", "otari"]) }).strict();
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    authorize(request);
    const options = { patches: z.array(patchSchema).max(25), format: z.enum(["addon", "source"]).default("addon") };
    const body = z.union([z.object({ original: z.unknown(), ...options }).strict(), z.object({ projectId: z.uuid(), ...options }).strict()]).parse(await readJson(request));
    // Collapse successive patches per file while preserving the original base.
    const combined = new Map<string, z.infer<typeof patchSchema>>();
    for (const patch of body.patches) {
      const previous = combined.get(patch.path);
      if (previous && previous.after !== patch.before) throw new Error("Patch sequence does not match");
      combined.set(patch.path, previous ? { ...patch, before: previous.before } : patch);
    }
    const output = await exportZip("projectId" in body ? recalledProject(body.projectId) : validateProject(body.original), [...combined.values()], body.format);
    return new Response(new Uint8Array(output.bytes), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${output.name}"`, "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
