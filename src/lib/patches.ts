import { createHash } from "node:crypto";
import { z } from "zod";
import { analyze, readManifest } from "./analyzer";
import { safePath, validateProject } from "./archive";
import type { Patch, Project } from "./types";

export function deterministicPatches(project: Project): Patch[] {
  const before = project.files.find(f => f.path === "manifest.json")!.content;
  const manifest = readManifest(project);
  const report = analyze(project);
  const reasons: string[] = [];
  if (manifest.background?.service_worker && !manifest.background.scripts && !manifest.background.page &&
      !report.findings.some(f => f.severity === "blocked" && (f.file === manifest.background.service_worker || ["mixed-background", "service-worker", "persistent-v3"].includes(f.rule)))) {
    const worker = manifest.background.service_worker;
    const { service_worker: _worker, ...rest } = manifest.background;
    manifest.background = { ...rest, scripts: [worker] };
    reasons.push("Use Firefox MV3 background scripts while keeping the original worker source and module type.");
  }
  if ([2, 3].includes(manifest.manifest_version) && !manifest.browser_specific_settings?.gecko?.id) {
    const id = createHash("sha256").update(before).digest("hex").slice(0, 20);
    manifest.browser_specific_settings = { ...manifest.browser_specific_settings, gecko: { ...manifest.browser_specific_settings?.gecko, id: `bridgefox-${id}@bridgefox.local` } };
    reasons.push("Assign a stable local Firefox add-on ID for temporary testing. This does not register or sign the add-on.");
  }
  return reasons.length ? [{ path: "manifest.json", before, after: JSON.stringify(manifest, null, 2) + "\n", reason: reasons.join(" "), origin: "rules" }] : [];
}
export const aiResponseSchema = z.object({
  summary: z.string().max(4000),
  risks: z.array(z.string().max(1500)).max(30).default([]),
  patches: z.array(z.object({ path: z.string().refine(safePath), before: z.string().max(100000), after: z.string().min(1).max(100000), reason: z.string().min(1).max(2000) }).strict()).max(12).default([])
}).strict();
export function parseAiJson(text: string): z.infer<typeof aiResponseSchema> {
  const clean = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  return aiResponseSchema.parse(JSON.parse(clean));
}
export function applyPatches(project: Project, patches: Patch[]): Project {
  const files = project.files.map(f => ({ ...f }));
  const changed = new Set<string>();
  for (const patch of patches) {
    if (!safePath(patch.path) || changed.has(patch.path)) throw new Error("Unsafe or duplicate patch path");
    changed.add(patch.path);
    const file = files.find(f => f.path === patch.path);
    if (!file || file.encoding !== "utf8" || file.content !== patch.before) throw new Error(`Patch does not match the source of ${patch.path}`);
    if (!patch.after.trim()) throw new Error("Patches cannot empty a source file");
    file.content = patch.after;
  }
  const output = validateProject({ ...project, files });
  const before = readManifest(project), after = readManifest(output);
  const mutable = new Set(["background", "browser_specific_settings"]);
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!mutable.has(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key])) throw new Error(`Guardrail rejected a change to manifest.${key}`);
  }
  // Source changes remain proposals. Manifest entrypoints and Firefox identity have narrow invariants.
  if (before.background) {
    const { service_worker, ...rest } = before.background;
    const expected = service_worker ? { ...rest, scripts: [service_worker] } : before.background;
    if (JSON.stringify(after.background) !== JSON.stringify(expected) && JSON.stringify(after.background) !== JSON.stringify(before.background)) throw new Error("Guardrail rejected a background behavior or entrypoint change");
  } else if (after.background) throw new Error("Guardrail rejected a new background entrypoint");
  const strippedSettings = (m: Record<string, any>) => {
    const settings = structuredClone(m.browser_specific_settings ?? {});
    if (settings.gecko) { delete settings.gecko.id; if (Object.keys(settings.gecko).length === 0) delete settings.gecko; }
    return settings;
  };
  if (JSON.stringify(strippedSettings(before)) !== JSON.stringify(strippedSettings(after))) throw new Error("Guardrail rejected Firefox settings changes");
  if (before.browser_specific_settings?.gecko?.id && before.browser_specific_settings.gecko.id !== after.browser_specific_settings?.gecko?.id) throw new Error("Guardrail rejected an add-on identity change");
  const existingBlockers = analyze(project).findings.filter(f => f.severity === "blocked");
  const newBlockers = analyze(output).findings.filter(f => f.severity === "blocked" && !existingBlockers.some(o => o.rule === f.rule && o.file === f.file));
  if (newBlockers.length) throw new Error(`Patch introduced a blocker: ${newBlockers[0].title}`);
  const resolvedBlocker = existingBlockers.find(f => !f.automatic && f.rule !== "syntax" && !analyze(output).findings.some(o => o.rule === f.rule && o.file === f.file));
  if (resolvedBlocker) throw new Error(`Manual redesign required: ${resolvedBlocker.title}. AI cannot automatically clear this original blocker.`);
  return output;
}
