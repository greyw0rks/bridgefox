import { z } from "zod";
import { importZip, LIMITS } from "@/lib/archive";
import { analyze } from "@/lib/analyzer";
import { editorProject, rememberProject } from "@/lib/project-store";
import { authorize, boundedBody, errorResponse, HttpError, readJson } from "@/lib/http";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    authorize(request);
    const { url, branch } = z.object({ url: z.string().max(500), branch: z.string().min(1).max(100).regex(/^[\w./-]+$/).refine(s => !s.includes("..") && !s.startsWith("/")) }).strict().parse(await readJson(request));
    const parsed = new URL(url);
    const parts = parsed.pathname.replace(/\/$/, "").split("/").filter(Boolean);
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash || parts.length !== 2 || !parts.every(p => /^[\w.-]+$/.test(p))) throw new Error("Enter a public repository URL like https://github.com/owner/repository");
    const response = await fetch(`https://codeload.github.com/${parts.map(encodeURIComponent).join("/")}/zip/refs/heads/${branch.split("/").map(encodeURIComponent).join("/")}`, { redirect: "error", signal: AbortSignal.timeout(120000), cache: "no-store" });
    if (!response.ok) throw new HttpError(400, "Could not download that public repository branch. Check the URL and branch name.");
    const bytes = await boundedBody(new Request("https://codeload.github.com", { method: "POST", body: response.body, duplex: "half", headers: response.headers } as RequestInit), LIMITS.upload);
    const project = await importZip(Buffer.from(bytes), parts[1]);
    const report = analyze(project);
    return Response.json({ projectId: rememberProject(project), project: editorProject(project), report });
  } catch (error) { return errorResponse(error); }
}
