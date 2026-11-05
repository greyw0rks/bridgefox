import { parse } from "acorn";
import { full } from "acorn-walk";
import compat from "./compat-data.json";
import type { Node } from "acorn";
import { fileBytes, safePath } from "./archive";
import type { ApiUse, Finding, Project, Report, Validation } from "./types";

export const MDN = "https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions";
const unsupported = new Set(["offscreen", "sidePanel", "debugger", "gcm", "ttsEngine", "enterprise", "fileSystem", "sockets", "webstore", "instanceID", "processes", "certificateProvider", "printerProvider", "platformKeys"]);
export function apiSupport(namespace: string, member: string): ApiUse["support"] {
  return (compat.api as Record<string, Record<string, ApiUse["support"]>>)[namespace]?.[member] ?? (unsupported.has(namespace) ? "unsupported" : "review");
}
// Acorn nodes are narrowed structurally here; never evaluate source.
type Ast = Node & { type: string; object?: Ast; property?: Ast; computed?: boolean; name?: string; value?: unknown; loc?: { start: { line: number } }; callee?: Ast };
function memberParts(node: Ast): string[] | undefined {
  if (node.type === "Identifier") return [node.name ?? ""];
  if (node.type !== "MemberExpression" || !node.object || !node.property) return;
  const left = memberParts(node.object);
  const right = node.computed ? (node.property.type === "Literal" && typeof node.property.value === "string" ? node.property.value : undefined) : node.property.name;
  return left && right ? [...left, right] : undefined;
}
export function readManifest(project: Project): Record<string, any> {
  const source = project.files.find(f => f.path === "manifest.json");
  if (!source || source.encoding !== "utf8") throw new Error("manifest.json must be UTF-8 text");
  let manifest: unknown;
  try { manifest = JSON.parse(source.content); } catch { throw new Error("manifest.json is not valid JSON"); }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("manifest.json must be an object");
  return manifest as Record<string, any>;
}
export function analyze(project: Project): Report {
  const manifest = readManifest(project);
  const findings: Finding[] = [], apis: ApiUse[] = [];
  const add = (f: Omit<Finding, "id">) => findings.push({ ...f, id: `${f.rule}:${f.file}:${f.line ?? 0}:${findings.length}` });
  const manifestFinding = (rule: string, title: string, detail: string, severity: Finding["severity"], automatic = false, source = `${MDN}/manifest.json`) => add({ rule, title, detail, severity, automatic, file: "manifest.json", source });
  // Reject malformed nested data before traversing it; preserve the original source.
  for (const key of ["background", "action", "browser_action", "page_action", "browser_specific_settings", "icons", "options_ui"]) {
    if (manifest[key] !== undefined && (!manifest[key] || typeof manifest[key] !== "object" || Array.isArray(manifest[key]))) throw new Error(`manifest.${key} must be an object`);
  }
  if (manifest.browser_specific_settings?.gecko !== undefined && (!manifest.browser_specific_settings.gecko || typeof manifest.browser_specific_settings.gecko !== "object" || Array.isArray(manifest.browser_specific_settings.gecko))) throw new Error("manifest.browser_specific_settings.gecko must be an object");
  if (![2, 3].includes(manifest.manifest_version)) manifestFinding("manifest-version", "Unsupported manifest version", "Only Manifest V2 and V3 extension source is supported.", "blocked");
  if (typeof manifest.name !== "string" || !manifest.name || typeof manifest.version !== "string" || !/^\d+(\.\d+){0,3}$/.test(manifest.version) || manifest.version.split(".").some((part: string) => Number(part) > 65535)) manifestFinding("manifest-fields", "Manifest name or version is invalid", "A name and a Firefox-compatible numeric extension version are required.", "blocked");
  if (manifest.background?.service_worker) {
    const worker = manifest.background.service_worker;
    const exists = typeof worker === "string" && project.files.some(f => f.path === worker && f.encoding === "utf8");
    manifestFinding("service-worker", "Background service worker needs a Firefox script", "Firefox uses background scripts for MV3. Preserve the worker source and switch the manifest entry; lifecycle-dependent behavior still needs a browser test.", exists ? "change" : "blocked", exists, `${MDN}/manifest.json/background`);
    if (manifest.background.scripts || manifest.background.page) manifestFinding("mixed-background", "Multiple background configurations", "This package declares more than one background entry. Resolve the intended entry before converting.", "blocked");
  }
  if (manifest.manifest_version === 3 && "persistent" in (manifest.background ?? {})) manifestFinding("persistent-v3", "MV3 persistent flag is invalid", "MV3 backgrounds are non-persistent; review lifecycle behavior before removing this flag.", "blocked");
  if (!manifest.browser_specific_settings?.gecko?.data_collection_permissions) manifestFinding("data-collection", "Declare Firefox data collection", "New Firefox add-ons need a data_collection_permissions declaration. The author must describe actual collection; BridgeFox cannot infer that an extension collects no data.", "warning", false, `${MDN}/manifest.json/browser_specific_settings`);
  const chromeKeys = ["minimum_chrome_version", "key", "update_url"];
  for (const key of chromeKeys) if (key in manifest) manifestFinding(`chrome-key-${key}`, `Review ${key}`, key === "key" ? "Chrome's embedded public key does not establish a Firefox add-on identity." : key === "update_url" ? "A Chrome update endpoint cannot distribute Firefox updates. Configure a Firefox update channel if needed." : "This Chrome version requirement cannot specify a Firefox minimum version.", "warning");
  for (const key of ["side_panel", "chrome_url_overrides", "oauth2", "sandbox"]) if (key in manifest) manifestFinding(`manifest-${key}`, `Review ${key}`, key === "chrome_url_overrides" ? "Firefox can override newtab, but Chrome history/bookmarks overrides are unsupported. Check the configured pages." : `The ${key} configuration has browser-specific behavior and needs a manual compatibility decision.`, "warning");
  const permissions: string[] = [];
  for (const key of ["permissions", "optional_permissions", "host_permissions", "optional_host_permissions"]) {
    if (manifest[key] !== undefined && (!Array.isArray(manifest[key]) || manifest[key].some((p: unknown) => typeof p !== "string"))) manifestFinding(`invalid-${key}`, `${key} must be a string array`, "Malformed permissions cannot be migrated safely.", "blocked");
    else if (Array.isArray(manifest[key])) permissions.push(...manifest[key]);
  }
  for (const permission of permissions) {
    if (unsupported.has(permission) || ["unlimitedStorage", "nativeMessaging", "declarativeNetRequest", "declarativeNetRequestWithHostAccess", "identity", "system.cpu", "system.memory", "system.storage"].includes(permission)) {
      manifestFinding(`permission-${permission}`, `Review ${permission} permission`, permission === "nativeMessaging" ? "Native host applications need Firefox registration and cannot be translated by this tool." : `Check Firefox support and semantics for ${permission}. This permission will be preserved.`, unsupported.has(permission) || permission.startsWith("system.") ? "blocked" : "warning", false, `${MDN}/manifest.json/permissions`);
    }
  }
  const referenced: string[] = [];
  const collect = (value: unknown) => { if (typeof value === "string") referenced.push(value); else if (value != null) manifestFinding("invalid-resource", "Invalid manifest resource", "Manifest resource paths must be strings.", "blocked"); };
  collect(manifest.background?.service_worker);
  collect(manifest.background?.page);
  if (manifest.background?.scripts != null && !Array.isArray(manifest.background.scripts)) manifestFinding("invalid-background-scripts", "Background scripts must be an array", "Correct the background scripts definition.", "blocked");
  else for (const path of manifest.background?.scripts ?? []) collect(path);
  for (const key of ["action", "browser_action", "page_action"]) {
    collect(manifest[key]?.default_popup);
    const icons = manifest[key]?.default_icon;
    if (typeof icons === "string") collect(icons); else if (icons && typeof icons === "object") Object.values(icons).forEach(collect);
  }
  if (manifest.icons && typeof manifest.icons === "object") Object.values(manifest.icons).forEach(collect);
  collect(manifest.options_ui?.page); collect(manifest.options_page); collect(manifest.devtools_page);
  if (manifest.content_scripts !== undefined && !Array.isArray(manifest.content_scripts)) manifestFinding("invalid-content-scripts", "Content scripts must be an array", "Correct the content script configuration.", "blocked");
  else for (const script of manifest.content_scripts ?? []) {
    if (!script || typeof script !== "object") { manifestFinding("invalid-content-script", "Invalid content script", "Each content script must be an object.", "blocked"); continue; }
    for (const key of ["js", "css"]) if (Array.isArray(script[key])) script[key].forEach(collect); else if (script[key] !== undefined) manifestFinding("invalid-script-array", `Content script ${key} must be an array`, "Correct the resource list.", "blocked");
  }
  for (const path of new Set(referenced)) if (!safePath(path) || !project.files.some(f => f.path === path)) manifestFinding(`missing-${path}`, `Missing resource: ${path}`, "The manifest points to a file that is not present in this package.", "blocked");
  for (const file of project.files) {
    if (file.encoding !== "utf8") continue;
    if (/\.(js|mjs|cjs)$/i.test(file.path)) {
      let ast: Node;
      try { ast = parse(file.content, { ecmaVersion: "latest", sourceType: "module", locations: true, allowHashBang: true }); }
      catch (error) { add({ rule: "syntax", title: "JavaScript could not be parsed", detail: error instanceof Error ? error.message : "Syntax error", severity: "blocked", automatic: false, file: file.path }); continue; }
      const seen = new Set<string>();
      full(ast, raw => {
        const node = raw as Ast;
        const parts = memberParts(node);
        if (parts && ["chrome", "browser"].includes(parts[0]) && parts.length >= 3) {
          const api = `${parts[1]}.${parts[2]}`;
          if (seen.has(api)) return;
          seen.add(api);
          const support = apiSupport(parts[1], parts[2]);
          const notSupported = support === "unsupported";
          apis.push({ api, file: file.path, line: node.loc?.start.line ?? 1, support });
          if (support !== "supported") add({ rule: `api-${api}`, title: `${api} ${notSupported ? "is not portable" : "needs review"}`, detail: notSupported ? "Mozilla compatibility data reports no current Firefox support. A replacement design is required; this call is preserved." : "Compatibility data is absent, partial, or behind a flag. Check Firefox compatibility and behavior before installing.", file: file.path, line: node.loc?.start.line, severity: notSupported ? "blocked" : "warning", automatic: false, source: `${MDN}/API/${parts[1]}/${parts[2]}` });
        }
        if (node.type === "Identifier" && ["importScripts", "ServiceWorkerGlobalScope", "clients"].includes(node.name ?? "") && file.path === manifest.background?.service_worker) add({ rule: "worker-context", title: "Worker-specific background behavior", detail: `${node.name} may not work in a Firefox background page. Refactor and verify this source manually.`, severity: "blocked", automatic: false, file: file.path, line: node.loc?.start.line, source: `${MDN}/manifest.json/background` });
        if ((node.type === "CallExpression" && node.callee?.name === "eval") || (["CallExpression", "NewExpression"].includes(node.type) && node.callee?.name === "Function")) add({ rule: "dynamic-code", title: "Dynamic executable code", detail: "Extension CSP and add-on policies restrict dynamic code. Review before packaging.", severity: "blocked", automatic: false, file: file.path, line: node.loc?.start.line });
      });
    }
    if (/\.html$/i.test(file.path) && /<script\b[^>]*src\s*=\s*["']https?:/i.test(file.content.replace(/<!--[\s\S]*?-->/g, ""))) add({ rule: "dynamic-code", title: "Remote executable code", detail: "Extension CSP and add-on policies restrict remote code. Review before packaging.", severity: "blocked", automatic: false, file: file.path });
  }
  if (project.files.some(f => /\.(ts|tsx)$/i.test(f.path))) add({ rule: "build-source", title: "Build-source files detected", detail: "TypeScript is not compiled here. Import a built extension ZIP and keep build sources in your repository.", severity: "warning", automatic: false, file: "manifest.json" });
  const weight = findings.reduce((n, f) => n + (f.severity === "blocked" ? 25 : f.severity === "change" ? 12 : 7), 0);
  return { name: typeof manifest.name === "string" ? manifest.name : project.name, version: typeof manifest.version === "string" ? manifest.version : "unknown", manifestVersion: Number(manifest.manifest_version) || 0, findings, apis, permissions: [...new Set(permissions)], fileCount: project.files.length, sizeBytes: project.files.reduce((n, f) => n + fileBytes(f).length, 0), score: Math.max(0, 100 - weight) };
}
export function validate(project: Project, original: Project): Validation[] {
  const report = analyze(project);
  const before = readManifest(original), after = readManifest(project);
  const keys = ["permissions", "optional_permissions", "host_permissions", "optional_host_permissions"];
  const unchanged = keys.every(key => JSON.stringify(before[key] ?? []) === JSON.stringify(after[key] ?? []));
  const blocked = report.findings.filter(f => f.severity === "blocked");
  return [
    { name: "Manifest & referenced files", status: report.findings.some(f => f.file === "manifest.json" && f.severity === "blocked") ? "failed" : "passed", detail: "Required fields, manifest version, and declared background, popup, icons and content-script resources checked." },
    { name: "JavaScript syntax", status: report.findings.some(f => f.rule === "syntax") ? "failed" : "passed", detail: "JavaScript parsed as source; no uploaded code was run." },
    { name: "Permission preservation", status: unchanged ? "passed" : "failed", detail: unchanged ? "Required and optional permissions and host access are unchanged." : "Permission changes were rejected." },
    { name: "Compatibility rules", status: blocked.length ? "failed" : report.findings.length ? "review" : "passed", detail: `${blocked.length} blockers; ${report.findings.filter(f => f.severity !== "blocked").length} findings need review. API detection is best effort, not a full semantic proof.` },
    { name: "Firefox runtime", status: "review", detail: "Load temporarily in desktop Firefox using about:debugging and test every extension feature. Static checks cannot certify runtime compatibility." }
  ];
}
