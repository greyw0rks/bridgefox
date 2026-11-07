import { readManifest } from "./analyzer";
import type { Project, Report } from "./types";

export const AI_SOURCE_CHAR_LIMIT = 90000;

// Include entire files so exact before/after patch validation remains possible.
// Large assets and omitted source stay in the project and exported archive.
export function selectAiContext(project: Project, report: Report) {
  const manifest = readManifest(project);
  const entrypoints = new Set<string>();
  const add = (value: unknown) => { if (typeof value === "string") entrypoints.add(value); };
  add(manifest.background?.service_worker);
  add(manifest.background?.page);
  for (const path of Array.isArray(manifest.background?.scripts) ? manifest.background.scripts : []) add(path);
  add(manifest.action?.default_popup);
  add(manifest.browser_action?.default_popup);
  add(manifest.options_ui?.page);
  for (const script of Array.isArray(manifest.content_scripts) ? manifest.content_scripts : []) {
    for (const key of ["js", "css"]) for (const path of Array.isArray(script?.[key]) ? script[key] : []) add(path);
  }
  const findingFiles = new Set(report.findings.map(f => f.file));
  const candidates = project.files.filter(f => f.encoding === "utf8" && /\.(json|js|mjs|cjs|html|css|ts|tsx|jsx)$/i.test(f.path));
  const rank = (path: string) => path === "manifest.json" ? 0 : path === project.source?.manifestPath || entrypoints.has(path) ? 1 : findingFiles.has(path) ? 2 : /\.(js|mjs|cjs|ts|tsx|jsx)$/i.test(path) ? 3 : 4;
  candidates.sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
  const manifestFile = candidates.find(f => f.path === "manifest.json");
  if (!manifestFile || manifestFile.content.length > AI_SOURCE_CHAR_LIMIT) throw new Error("The manifest exceeds the AI context allowance. Local scan and export remain available.");
  const files: Project["files"] = [];
  const omittedPaths: string[] = [];
  let characters = 0;
  for (const file of candidates) {
    if (characters + file.content.length > AI_SOURCE_CHAR_LIMIT) { omittedPaths.push(file.path); continue; }
    files.push(file);
    characters += file.content.length;
  }
  return {
    files, omittedPaths, sourceFileCount: candidates.length, characters,
    // Bound report metadata separately from source to keep gateway input finite.
    findings: { name: report.name.slice(0, 200), version: report.version.slice(0, 100), manifestVersion: report.manifestVersion, fileCount: report.fileCount, sizeBytes: report.sizeBytes, score: report.score,
      findings: report.findings.slice(0, 100).map(f => ({ severity: f.severity, title: f.title.slice(0, 500), detail: f.detail.slice(0, 1500), file: f.file, line: f.line, rule: f.rule.slice(0, 256), automatic: f.automatic })),
      apis: report.apis.slice(0, 100).map(a => ({ ...a, api: a.api.slice(0, 256) })), permissions: report.permissions.slice(0, 100).map(p => p.slice(0, 256)), omittedFindings: Math.max(0, report.findings.length - 100), omittedApis: Math.max(0, report.apis.length - 100), omittedPermissions: Math.max(0, report.permissions.length - 100) },
    scope: { includedPaths: files.map(f => f.path), omittedSourceCount: omittedPaths.length, omittedSourceExamples: omittedPaths.slice(0, 20), sourceRepository: project.source ? { manifestPath: project.source.manifestPath, manifestCandidateCount: project.source.manifestCandidates.length, buildRequired: true } : null, rule: "Only included source was supplied to the models. Omitted files need manual review and must not be patched or described as AI-reviewed. For a source repository, manifest.json is an analysis copy: only patch the actual selected manifest path, and do not claim it has been built or runtime-tested." },
  };
}
