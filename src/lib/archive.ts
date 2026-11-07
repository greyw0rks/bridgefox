import yauzl from "yauzl";
import { z } from "zod";
import type { Project, SourceFile } from "./types";
import { LIMITS, UPLOAD_SIZE_LABEL, EXTRACTION_LIMIT_LABEL } from "./limits";

export { LIMITS } from "./limits";
export function safePath(path: string): boolean {
  return path.length > 0 && path.length <= 240 && !/[\\\x00-\x1f\x7f:]/.test(path) && !path.startsWith("/") &&
    path.split("/").every(p => p !== ".." && p !== "." && p.length > 0);
}
export function fileBytes(file: SourceFile): Buffer {
  return Buffer.from(file.content, file.encoding === "base64" ? "base64" : "utf8");
}
const fileSchema = z.object({ path: z.string().refine(safePath, "Unsafe file path"), content: z.string().max(LIMITS.file * 2), encoding: z.enum(["utf8", "base64"]) }).strict();
const sourceSchema = z.object({ manifestPath: z.string().refine(safePath), manifestCandidates: z.array(z.string().refine(safePath)).min(1).max(LIMITS.files), buildRequired: z.literal(true) }).strict();
const projectSchema = z.object({ name: z.string().min(1).max(200), files: z.array(fileSchema).min(1).max(LIMITS.files + 1), source: sourceSchema.optional() }).strict();
const sizeLabel = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
export function validateProject(input: unknown): Project {
  const project = projectSchema.parse(input);
  if (project.files.length - (project.source ? 1 : 0) > LIMITS.files) throw new Error("Project has too many files");
  let total = 0;
  const names = new Set<string>();
  for (const file of project.files) {
    if (names.has(file.path.toLowerCase())) throw new Error("Duplicate file path");
    names.add(file.path.toLowerCase());
    const bytes = fileBytes(file);
    // Canonical round-trip validation stays linear for multi-megabyte assets.
    if (file.encoding === "base64" && bytes.toString("base64") !== file.content) throw new Error("Invalid binary encoding");
    const size = bytes.length;
    if (size > LIMITS.file) throw new Error(`File ${file.path} (${sizeLabel(size)}) exceeds the ${sizeLabel(LIMITS.file)} per-file limit`);
    if (!(project.source && file.path === "manifest.json")) total += size;
    if (total > LIMITS.total) throw new Error(`Extracted extension exceeds ${sizeLabel(LIMITS.total)} while reading ${file.path} (${sizeLabel(total)} total)`);
  }
  const manifests = project.files.filter(f => f.path === "manifest.json" && f.encoding === "utf8");
  if (manifests.length !== 1) throw new Error("A UTF-8 manifest.json is required at the extension root");
  if (project.source) {
    const selected = project.files.find(f => f.path === project.source!.manifestPath && f.encoding === "utf8");
    if (!project.source.manifestCandidates.includes(project.source.manifestPath) || !selected || selected.content !== manifests[0].content || project.source.manifestPath === "manifest.json") throw new Error("Source repository manifest selection is invalid");
    if (project.source.manifestCandidates.some(path => !project.files.some(f => f.path === path && f.encoding === "utf8"))) throw new Error("Source repository manifest candidate is missing");
  }
  return project;
}
export async function importZip(bytes: Buffer, name: string): Promise<Project> {
  if (bytes.length > LIMITS.upload) throw new Error(`ZIP upload must be at most ${UPLOAD_SIZE_LABEL}`);
  const files: SourceFile[] = await new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error || !zip) return reject(new Error("Could not read this ZIP archive"));
      const extracted: SourceFile[] = [];
      const names = new Set<string>();
      let entries = 0, total = 0, stopped = false;
      const fail = (message: string) => { if (!stopped) { stopped = true; zip.close(); reject(new Error(message)); } };
      zip.on("error", () => fail("ZIP is corrupt or has unsafe entries"));
      zip.on("entry", entry => {
        if (stopped) return;
        if (++entries > LIMITS.files) return fail(`ZIP has too many entries (maximum ${LIMITS.files.toLocaleString("en-US")})`);
        const path = entry.fileName;
        if (!safePath(path.replace(/\/$/, ""))) return fail("ZIP contains an unsafe file path");
        const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (mode === 0xa000) return fail("ZIP symlinks are not allowed");
        if (entry.generalPurposeBitFlag & 1) return fail("Encrypted ZIPs are not supported");
        if (names.has(path.toLowerCase())) return fail("ZIP contains duplicate file names");
        names.add(path.toLowerCase());
        if (path.endsWith("/")) return zip.readEntry();
        if (entry.uncompressedSize > LIMITS.file) return fail(`File ${path} (${sizeLabel(entry.uncompressedSize)}) exceeds the ${sizeLabel(LIMITS.file)} per-file limit`);
        if (total + entry.uncompressedSize > LIMITS.total) return fail(`ZIP exceeds the ${sizeLabel(LIMITS.total)} extracted total while reading ${path} (${sizeLabel(total + entry.uncompressedSize)} total)`);
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return fail("Could not extract ZIP entry");
          const chunks: Buffer[] = [];
          let size = 0;
          stream.on("error", () => fail("Could not decompress ZIP entry"));
          stream.on("data", (chunk: Buffer) => {
            size += chunk.length;
            total += chunk.length;
            if (size > LIMITS.file || total > LIMITS.total) { stream.destroy(); fail(`ZIP exceeds extraction limits while reading ${path} (${sizeLabel(size)} file, ${sizeLabel(total)} total; ${EXTRACTION_LIMIT_LABEL})`); return; }
            chunks.push(chunk);
          });
          stream.on("end", () => {
            if (stopped) return;
            const buffer = Buffer.concat(chunks);
            const text = /\.(json|js|mjs|cjs|html|css|txt|md|svg|xml|map|ts|tsx|jsx|yml|yaml)$/i.test(path) || /(^|\/)(LICENSE|NOTICE)$/i.test(path);
            let content: string;
            try { content = text ? new TextDecoder("utf-8", { fatal: true }).decode(buffer) : buffer.toString("base64"); }
            catch { return fail("Text source must use UTF-8 encoding"); }
            extracted.push({ path, content, encoding: text ? "utf8" : "base64" });
            zip.readEntry();
          });
        });
      });
      zip.on("end", () => { if (!stopped) resolve(extracted); });
      zip.readEntry();
    });
  });
  const manifests = files.filter(f => f.path.split("/").at(-1) === "manifest.json");
  // Source repositories may carry browser-specific manifest templates and build tools.
  // Preserve the entire repository, and provide an explicit analysis-only manifest copy.
  const packages = files.filter(f => f.encoding === "utf8" && f.path.endsWith("package.json")).sort((a, b) => a.path.split("/").length - b.path.split("/").length);
  if (!manifests.some(f => f.path === "manifest.json")) for (const pkg of packages) {
    const prefix = pkg.path.slice(0, -"package.json".length);
    if (files.some(f => !f.path.startsWith(prefix))) continue;
    const candidates = manifests.filter(f => f.encoding === "utf8" && f.path.startsWith(prefix) && /\/(?:src\/)?manifests?\//.test(`/${f.path.slice(prefix.length)}`));
    if (!candidates.length || !files.some(f => f.path.startsWith(prefix) && /\.(ts|tsx)$/.test(f.path))) continue;
    let packageInfo: Record<string, any>;
    try { packageInfo = JSON.parse(pkg.content); } catch { continue; }
    if (!packageInfo?.scripts || !Object.keys(packageInfo.scripts).some(key => key.startsWith("build"))) continue;
    const valid = candidates.filter(f => { try { return [2, 3].includes(JSON.parse(f.content).manifest_version); } catch { return false; } });
    if (!valid.length) continue;
    const rank = (f: SourceFile) => /chrome[^/]*mv3/i.test(f.path) ? 0 : /chrome/i.test(f.path) ? 1 : /firefox/i.test(f.path) ? 2 : 3;
    valid.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
    const selected = valid[0];
    const normalized = files.filter(f => f.path.startsWith(prefix)).map(f => ({ ...f, path: f.path.slice(prefix.length) }));
    const projectName = typeof packageInfo.name === "string" && packageInfo.name ? packageInfo.name.slice(0, 200) : name.replace(/\.zip$/i, "").slice(0, 200);
    return validateProject({ name: projectName, files: [{ path: "manifest.json", content: selected.content, encoding: "utf8" }, ...normalized], source: { manifestPath: selected.path.slice(prefix.length), manifestCandidates: valid.map(f => f.path.slice(prefix.length)), buildRequired: true } });
  }
  const rootManifest = manifests.find(f => f.path === "manifest.json") ?? (manifests.length === 1 ? manifests[0] : undefined);
  if (!rootManifest) throw new Error("Choose a ZIP with one extension root; manifest.json was missing or ambiguous");
  const prefix = rootManifest.path.slice(0, -"manifest.json".length);
  return validateProject({ name: name.replace(/\.zip$/i, "").slice(0, 200) || "Extension", files: files.filter(f => f.path.startsWith(prefix)).map(f => ({ ...f, path: f.path.slice(prefix.length) })) });
}
