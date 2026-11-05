import yauzl from "yauzl";
import { z } from "zod";
import type { Project, SourceFile } from "./types";

export const LIMITS = { upload: 8 * 1024 * 1024, total: 16 * 1024 * 1024, file: 2 * 1024 * 1024, files: 400, request: 24 * 1024 * 1024 };
export function safePath(path: string): boolean {
  return path.length > 0 && path.length <= 240 && !/[\\\x00-\x1f\x7f:]/.test(path) && !path.startsWith("/") &&
    path.split("/").every(p => p !== ".." && p !== "." && p.length > 0);
}
export function fileBytes(file: SourceFile): Buffer {
  return Buffer.from(file.content, file.encoding === "base64" ? "base64" : "utf8");
}
const fileSchema = z.object({ path: z.string().refine(safePath, "Unsafe file path"), content: z.string().max(LIMITS.file * 2), encoding: z.enum(["utf8", "base64"]) }).strict();
const projectSchema = z.object({ name: z.string().min(1).max(200), files: z.array(fileSchema).min(1).max(LIMITS.files) }).strict();
export function validateProject(input: unknown): Project {
  const project = projectSchema.parse(input);
  let total = 0;
  const names = new Set<string>();
  for (const file of project.files) {
    if (names.has(file.path.toLowerCase())) throw new Error("Duplicate file path");
    names.add(file.path.toLowerCase());
    if (file.encoding === "base64" && (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content))) throw new Error("Invalid binary encoding");
    const size = fileBytes(file).length;
    if (size > LIMITS.file) throw new Error("Each file must be at most 2 MB");
    total += size;
    if (total > LIMITS.total) throw new Error("Extracted extension must be at most 16 MB");
  }
  const manifests = project.files.filter(f => f.path === "manifest.json" && f.encoding === "utf8");
  if (manifests.length !== 1) throw new Error("A UTF-8 manifest.json is required at the extension root");
  return project;
}
export async function importZip(bytes: Buffer, name: string): Promise<Project> {
  if (bytes.length > LIMITS.upload) throw new Error("ZIP upload must be at most 8 MB");
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
        if (++entries > LIMITS.files) return fail("ZIP has too many entries (maximum 400)");
        const path = entry.fileName;
        if (!safePath(path.replace(/\/$/, ""))) return fail("ZIP contains an unsafe file path");
        const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (mode === 0xa000) return fail("ZIP symlinks are not allowed");
        if (entry.generalPurposeBitFlag & 1) return fail("Encrypted ZIPs are not supported");
        if (names.has(path.toLowerCase())) return fail("ZIP contains duplicate file names");
        names.add(path.toLowerCase());
        if (path.endsWith("/")) return zip.readEntry();
        if (entry.uncompressedSize > LIMITS.file || total + entry.uncompressedSize > LIMITS.total) return fail("ZIP exceeds extraction limits (2 MB per file, 16 MB total)");
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return fail("Could not extract ZIP entry");
          const chunks: Buffer[] = [];
          let size = 0;
          stream.on("error", () => fail("Could not decompress ZIP entry"));
          stream.on("data", (chunk: Buffer) => {
            size += chunk.length;
            total += chunk.length;
            if (size > LIMITS.file || total > LIMITS.total) { stream.destroy(); fail("ZIP exceeds extraction limits"); return; }
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
  const rootManifest = manifests.find(f => f.path === "manifest.json") ?? (manifests.length === 1 ? manifests[0] : undefined);
  if (!rootManifest) throw new Error("Choose a ZIP with one extension root; manifest.json was missing or ambiguous");
  const prefix = rootManifest.path.slice(0, -"manifest.json".length);
  return validateProject({ name: name.replace(/\.zip$/i, "").slice(0, 200) || "Extension", files: files.filter(f => f.path.startsWith(prefix)).map(f => ({ ...f, path: f.path.slice(prefix.length) })) });
}
