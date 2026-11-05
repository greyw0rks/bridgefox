import JSZip from "jszip";
import { fileBytes, validateProject } from "./archive";
import { analyze } from "./analyzer";
import { applyPatches } from "./patches";
import type { Patch, Project } from "./types";

export async function exportZip(original: Project, patches: Patch[]) {
  const project = applyPatches(validateProject(original), patches);
  const report = analyze(project);
  if (report.findings.some(f => f.severity === "blocked")) throw new Error("Resolve blocking findings before exporting an installable candidate. Download the report to review them.");
  const zip = new JSZip();
  for (const file of project.files) zip.file(file.path, fileBytes(file));
  // Keep the extension's own files intact; report is a separate download in the UI.
  return { bytes: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }), name: report.name.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 70) + "-firefox.zip" };
}
