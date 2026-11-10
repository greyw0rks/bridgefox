import { randomUUID } from "node:crypto";
import { fileBytes, validateProject } from "./archive";
import { cloudConfigured, registerStoredProject, storedProjectUrl, uploadStoredFile, removeStoredFile } from "./cloud-store";
import { HttpError } from "./http";
import type { Project } from "./types";

const TTL = 30 * 60 * 1000;
const MAX_BYTES = 512 * 1024 * 1024;
type Entry = { project: Project; bytes: number; touched: number };
const shared = globalThis as typeof globalThis & { bridgefoxProjects?: Map<string, Entry> };
const projects = shared.bridgefoxProjects ??= new Map<string, Entry>();
function prune() {
  for (const [id, entry] of projects) if (Date.now() - entry.touched > TTL) projects.delete(id);
  let bytes = [...projects.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  while (projects.size > 4 || bytes > MAX_BYTES) {
    const first = projects.entries().next().value;
    if (!first) break;
    projects.delete(first[0]);
    bytes -= first[1].bytes;
  }
}
export function rememberProject(project: Project, existingId?: string) {
  const id = existingId ?? randomUUID();
  projects.delete(id);
  projects.set(id, { project, bytes: project.files.reduce((sum, file) => sum + fileBytes(file).length, 0), touched: Date.now() });
  prune();
  return id;
}
export function recalledProject(id: string): Project {
  const entry = projects.get(id);
  if (!entry || Date.now() - entry.touched > TTL) {
    projects.delete(id);
    throw new HttpError(410, "This imported project expired or the app restarted. Upload the original ZIP again to continue.");
  }
  entry.touched = Date.now();
  projects.delete(id);
  projects.set(id, entry);
  return entry.project;
}
export async function saveProject(project: Project, existingId?: string): Promise<string> {
  if (!cloudConfigured()) return rememberProject(project, existingId);
  const id = existingId ?? randomUUID();
  const bytes = project.files.reduce((sum, file) => sum + fileBytes(file).length, 0);
  const storageId = await uploadStoredFile(new TextEncoder().encode(JSON.stringify(project)), "application/json");
  try { await registerStoredProject(id, storageId, bytes); }
  catch (error) { await removeStoredFile(storageId).catch(() => {}); throw error; }
  return id;
}
export async function loadProject(id: string): Promise<Project> {
  if (!cloudConfigured()) return recalledProject(id);
  const url = await storedProjectUrl(id);
  if (!url) throw new HttpError(410, "This imported project expired. Upload the original ZIP again to continue.");
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new HttpError(410, "This imported project is unavailable. Upload the original ZIP again to continue.");
  return validateProject(await response.json());
}
// The editor only displays a preservation note for binary files. Keep those
// bytes on the server instead of copying base64 assets on every browser action.
export function editorProject(project: Project): Project {
  return { ...project, files: project.files.map(file => file.encoding === "base64" ? { ...file, content: "" } : file) };
}
