import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import JSZip from "jszip";
import { importZip, safePath, validateProject } from "../src/lib/archive";
import { analyze, apiSupport, readManifest } from "../src/lib/analyzer";
import { DEMO } from "../src/lib/demo";
import { migrate } from "../src/lib/migrate";
import { exportZip } from "../src/lib/export";
import { applyPatches, deterministicPatches, parseAiJson } from "../src/lib/patches";
import { authorize, boundedBody } from "../src/lib/http";
import { POST as githubImport } from "../src/app/api/github/route";
import { POST as analyzeProject } from "../src/app/api/analyze/route";
import { gatewayCall } from "../src/lib/otari";
import type { Patch, Project } from "../src/lib/types";
import { LIMITS } from "../src/lib/limits";
import { selectAiContext, AI_SOURCE_CHAR_LIMIT } from "../src/lib/ai-context";
import { lineReader } from "../src/lib/ndjson";
import { editorProject, recalledProject, rememberProject } from "../src/lib/project-store";
import { POST as migrateRequest } from "../src/app/api/migrate/route";
import { POST as exportRequest } from "../src/app/api/export/route";

const clone = () => structuredClone(DEMO);
test("project references keep complete binary assets on the server through migration and export", async () => {
  const project = clone();
  const asset = randomBytes(512 * 1024);
  project.files.push({ path: "audit.pdf", content: asset.toString("base64"), encoding: "base64" });
  const id = rememberProject(validateProject(project));
  assert.equal(editorProject(project).files.at(-1)?.content, "");
  assert.equal(recalledProject(id).files.at(-1)?.content, asset.toString("base64"));
  const request = new Request("http://localhost/api/migrate", { method: "POST", body: JSON.stringify({ projectId: id, mode: "local" }) });
  const response = await migrateRequest(request);
  assert.equal(response.status, 200);
  const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
  const result = events.find(event => event.type === "result").result;
  assert.equal(result.project.files.at(-1).content, "");
  const exported = await exportRequest(new Request("http://localhost/api/export", { method: "POST", body: JSON.stringify({ projectId: id, patches: result.patches }) }));
  assert.equal(exported.status, 200);
  const zip = await JSZip.loadAsync(await exported.arrayBuffer());
  assert.deepEqual(await zip.file("audit.pdf")!.async("nodebuffer"), asset);
  const expired = await migrateRequest(new Request("http://localhost/api/migrate", { method: "POST", body: JSON.stringify({ projectId: randomUUID(), mode: "local" }) }));
  assert.equal(expired.status, 410);
  assert.match((await expired.json()).error, /Upload the original ZIP again/);
});
test("project storage expires idle references and bounds retained projects", () => {
  const id = rememberProject(clone());
  const now = Date.now;
  try {
    Date.now = () => now() + 31 * 60 * 1000;
    assert.throws(() => recalledProject(id), /expired/);
  } finally { Date.now = now; }
  const first = rememberProject(clone());
  for (let i = 0; i < 4; i++) rememberProject(clone());
  assert.throws(() => recalledProject(first), /expired/);
});
test("migration stream preserves records split across network chunks, including a large final result", () => {
  const expected = [{ type: "activity", text: "one" }, { type: "result", source: "large source ".repeat(200000) }];
  const wire = "\n" + expected.map(value => JSON.stringify(value)).join("\n");
  const actual: unknown[] = [];
  const reader = lineReader(line => actual.push(JSON.parse(line)), wire.length);
  for (let start = 0; start < wire.length; start += 137) reader.push(wire.slice(start, start + 137));
  reader.finish();
  assert.deepEqual(actual, expected);
  const bounded = lineReader(() => {}, 4);
  bounded.push("123");
  assert.throws(() => bounded.push("45"), /response exceeds/);
});
function changeManifest(project: Project, change: (manifest: Record<string, any>) => void) { const m = readManifest(project); change(m); project.files[0].content = JSON.stringify(m); return project; }
function patch(project: Project, path: string, after: string): Patch { return { path, before: project.files.find(f => f.path === path)!.content, after, reason: "Test migration proposal", origin: "otari" }; }

async function sourceRepository() {
  const zip = new JSZip();
  zip.file("repo/package.json", JSON.stringify({ name: "source-wallet", scripts: { "build:firefox": "webpack" } }));
  zip.file("repo/src/main.ts", "const balance: number = 1;");
  for (const browser of ["chrome-mv2", "chrome-mv3", "firefox-mv2"]) {
    const manifest = readManifest(DEMO);
    manifest.name = "__MSG_name__";
    manifest.manifest_version = browser.endsWith("mv3") ? 3 : 2;
    zip.file(`repo/src/manifest/${browser}/manifest.json`, JSON.stringify(manifest));
  }
  // Rabby's audit PDF exceeds the former 32 MiB file limit.
  zip.file("repo/audits/report.pdf", Buffer.alloc(33 * 1024 * 1024, 37));
  zip.file("repo/LICENSE", "Original license");
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { project: await importZip(bytes, "source-wallet.zip"), zip };
}

test("source repositories preserve browser templates and assets, and export source without an analysis manifest", async () => {
  const { project, zip } = await sourceRepository();
  assert.equal(project.source?.manifestPath, "src/manifest/chrome-mv3/manifest.json");
  assert.equal(project.source?.manifestCandidates.length, 3);
  assert.equal(analyze(project).name, "source-wallet");
  assert.ok(analyze(project).findings.some(f => f.rule === "source-build" && f.severity === "blocked"));
  assert.deepEqual(deterministicPatches(project), []);
  await assert.rejects(exportZip(project, []), /Build this source repository/);
  const output = await exportZip(project, [], "source");
  assert.match(output.name, /-reviewed-source.zip$/);
  const extracted = await JSZip.loadAsync(output.bytes);
  assert.equal(extracted.file("manifest.json"), null);
  for (const [path, file] of Object.entries(zip.files)) if (!file.dir) {
    assert.deepEqual(await extracted.file(path.slice(5))!.async("nodebuffer"), await file.async("nodebuffer"));
  }
  assert.equal((await importZip(output.bytes, output.name)).source?.manifestCandidates.length, 3);
});

test("manifest selection reanalyzes the source, and patches use its real path with permission guards", async () => {
  const { project } = await sourceRepository();
  const path = "src/manifest/firefox-mv2/manifest.json";
  project.source!.manifestPath = path;
  project.files[0].content = project.files.find(f => f.path === path)!.content;
  const response = await analyzeProject(new Request("http://localhost/api/analyze", { method: "POST", body: JSON.stringify({ project }) }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.report.manifestVersion, 2);
  assert.equal(data.project.files.length, project.files.length);
  const selectedResponse = await analyzeProject(new Request("http://localhost/api/analyze", { method: "POST", body: JSON.stringify({ projectId: data.projectId, manifestPath: "src/manifest/chrome-mv3/manifest.json" }) }));
  assert.equal(selectedResponse.status, 200);
  assert.equal((await selectedResponse.json()).report.manifestVersion, 3);
  assert.equal(recalledProject(data.projectId).files.find(f => f.path === "audits/report.pdf")!.content, project.files.find(f => f.path === "audits/report.pdf")!.content);
  assert.throws(() => applyPatches(project, [patch(project, "manifest.json", project.files[0].content)]), /analysis copy/);
  const unselected = "src/manifest/chrome-mv3/manifest.json";
  assert.throws(() => applyPatches(project, [patch(project, unselected, "{}")]), /Select this manifest/);
  const manifest = readManifest(project);
  manifest.browser_specific_settings = { ...manifest.browser_specific_settings, gecko: { ...manifest.browser_specific_settings?.gecko, id: "source@example.org" } };
  const output = applyPatches(project, [patch(project, path, JSON.stringify(manifest))]);
  assert.equal(output.files[0].content, output.files.find(f => f.path === path)!.content);
  assert.deepEqual(readManifest(output).permissions, readManifest(project).permissions);
  manifest.permissions = [];
  assert.throws(() => applyPatches(project, [patch(project, path, JSON.stringify(manifest))]), /manifest.permissions/);
  project.files[0].content = "{}";
  assert.throws(() => validateProject(project), /manifest selection is invalid/);
});

test("the virtual source manifest does not consume an archive file slot", async () => {
  const { project } = await sourceRepository();
  project.files = project.files.filter(f => f.path !== "audits/report.pdf");
  while (project.files.length < LIMITS.files + 1) project.files.push({ path: `asset-${project.files.length}.txt`, content: "x", encoding: "utf8" });
  assert.equal(validateProject(project).files.length, LIMITS.files + 1);
  const ordinary = clone();
  ordinary.files = [ordinary.files[0], ...project.files.filter(f => f.path !== "manifest.json")];
  assert.throws(() => validateProject(ordinary), /too many files/);
});

test("Chrome fixture migrates, exports, and reimports with assets and permissions intact", async () => {
  const result = await migrate(DEMO, "local", () => {});
  assert.equal(result.status, "candidate");
  assert.equal(result.report.findings.length, 0);
  assert.equal(result.mode, "local");
  assert.equal(result.activities.some(a => a.origin === "otari"), false);
  assert.deepEqual(readManifest(result.project).permissions, readManifest(DEMO).permissions);
  assert.deepEqual(readManifest(result.project).background, { scripts: ["background.js"] });
  assert.equal(result.validations.find(v => v.name === "Firefox runtime")?.status, "review");
  const exported = await exportZip(DEMO, result.patches);
  const imported = await importZip(exported.bytes, exported.name);
  assert.equal(imported.files.length, DEMO.files.length);
  for (const file of DEMO.files.filter(f => f.path !== "manifest.json")) assert.equal(imported.files.find(f => f.path === file.path)?.content, file.content);
});
test("MV2 stays MV2 and a Firefox identity stays stable", () => {
  const project = changeManifest(clone(), m => { m.manifest_version = 2; m.background = { scripts: ["background.js"], persistent: false }; m.browser_action = m.action; delete m.action; });
  const once = applyPatches(project, deterministicPatches(project));
  assert.equal(readManifest(once).manifest_version, 2);
  assert.equal(deterministicPatches(once).length, 0);
});
test("Mozilla data detects an unsupported method inside the runtime namespace", () => {
  assert.equal(apiSupport("runtime", "requestUpdateCheck"), "unsupported");
  const project = clone(); project.files[1].content = "chrome.runtime.requestUpdateCheck(() => {});";
  assert.ok(analyze(project).findings.some(f => f.rule === "api-runtime.requestUpdateCheck" && f.severity === "blocked"));
});
test("unknown members require review; supported chrome calls are preserved", () => {
  assert.equal(apiSupport("tabs", "query"), "supported");
  assert.equal(apiSupport("tabs", "futureUnknownMethod"), "review");
  assert.equal(apiSupport("sidePanel", "open"), "unsupported");
  const project = clone(); project.files[1].content = "chrome['sidePanel']['open']({windowId: 1});";
  assert.ok(analyze(project).apis.some(a => a.api === "sidePanel.open" && a.support === "unsupported"));
});
test("worker-specific lifecycle code blocks automatic background conversion", () => {
  const project = clone(); project.files[1].content = "importScripts('dependency.js');";
  const result = applyPatches(project, deterministicPatches(project));
  assert.equal(readManifest(result).background.service_worker, "background.js");
  assert.ok(analyze(result).findings.some(f => f.rule === "worker-context"));
});
test("missing declared resources and malformed manifests cannot become candidates", () => {
  const missing = clone(); missing.files = missing.files.filter(f => f.path !== "popup.html");
  assert.ok(analyze(missing).findings.some(f => f.rule === "missing-popup.html"));
  const malformed = changeManifest(clone(), m => { m.background = "invalid"; });
  assert.throws(() => analyze(malformed), /background must be an object/);
  const version = changeManifest(clone(), m => { m.version = "70000.1"; });
  assert.ok(analyze(version).findings.some(f => f.rule === "manifest-fields"));
});
test("data collection needs an author declaration; migration does not invent one", () => {
  const project = changeManifest(clone(), m => { delete m.browser_specific_settings; });
  const output = applyPatches(project, deterministicPatches(project));
  assert.ok(analyze(output).findings.some(f => f.rule === "data-collection" && f.severity === "warning"));
  assert.equal(readManifest(output).browser_specific_settings.gecko.data_collection_permissions, undefined);
});
test("comments and string literals do not trigger executable-code blockers", () => {
  const project = clone(); project.files[1].content = '// Never use eval("x") or new Function("x").\nconst example = "eval(x)";';
  assert.equal(analyze(project).findings.some(f => f.rule === "dynamic-code"), false);
});
test("guardrails reject both permission escalation and removal", () => {
  for (const permissions of [["tabs", "storage"], []]) {
    const project = clone(); const m = readManifest(project); m.permissions = permissions;
    assert.throws(() => applyPatches(project, [patch(project, "manifest.json", JSON.stringify(m))]), /manifest.permissions/);
  }
});
test("guardrails reject feature deletion and background injection", () => {
  const project = clone(); const m = readManifest(project); delete m.action;
  assert.throws(() => applyPatches(project, [patch(project, "manifest.json", JSON.stringify(m))]), /manifest.action/);
  const background = readManifest(project); background.background = { scripts: ["background.js"], persistent: true };
  assert.throws(() => applyPatches(project, [patch(project, "manifest.json", JSON.stringify(background))]), /background behavior/);
});
test("patch application is atomic, exact, and rejects new executable code", () => {
  const project = clone();
  assert.throws(() => applyPatches(project, [{ ...patch(project, "popup.js", "const x = 1;"), before: "wrong" }]), /does not match/);
  assert.throws(() => applyPatches(project, [patch(project, "popup.js", "eval('network');")]), /introduced a blocker/);
  assert.deepEqual(project, DEMO);
});
test("unsupported feature cannot disappear through an AI patch or export", async () => {
  const project = clone(); project.files[1].content = "chrome.sidePanel.open({windowId: 1});";
  assert.throws(() => applyPatches(project, [patch(project, "background.js", "console.log('removed');")]), /Manual redesign/);
  await assert.rejects(exportZip(project, deterministicPatches(project)), /blocking findings/);
});
test("identity and licensing files are preserved", () => {
  const project = changeManifest(clone(), m => { m.browser_specific_settings = { gecko: { id: "original@example.org", strict_min_version: "121.0" } }; });
  const output = applyPatches(project, deterministicPatches(project));
  assert.deepEqual(readManifest(output).browser_specific_settings, readManifest(project).browser_specific_settings);
  assert.equal(output.files.find(f => f.path === "LICENSE")?.content, DEMO.files.find(f => f.path === "LICENSE")?.content);
});
test("ZIP nested extension root and binary assets survive extraction", async () => {
  const zip = new JSZip();
  for (const file of DEMO.files) zip.file(`repo-main/${file.path}`, file.content);
  zip.file("repo-main/icon.png", Buffer.from([0, 255, 128, 34]));
  const project = await importZip(await zip.generateAsync({ type: "nodebuffer" }), "repository.zip");
  assert.equal(project.files[0].path, "manifest.json");
  assert.equal(project.files.find(f => f.path === "icon.png")?.content, "AP+A Ig==".replace(" ", ""));
});
test("ZIP traversal, symlinks, duplicate paths, and oversized files are rejected", async () => {
  for (const kind of ["traversal", "symlink", "duplicate", "oversized"] as const) {
    const zip = new JSZip(); zip.file("manifest.json", DEMO.files[0].content);
    if (kind === "traversal") zip.file("../escape.js", "attack");
    if (kind === "symlink") zip.file("linked.js", "../outside", { unixPermissions: 0o120777 });
    if (kind === "duplicate") zip.file("MANIFEST.JSON", DEMO.files[0].content);
    if (kind === "oversized") zip.file("giant.js", "x".repeat(LIMITS.file + 1));
    await assert.rejects(importZip(await zip.generateAsync({ type: "nodebuffer", platform: "UNIX", compression: "DEFLATE" }), "unsafe.zip"), kind === "oversized" ? /giant.js.*64.0 MB.*per-file/ : /./);
  }
});
test("large ZIPs and bundles survive import, migration, JSON transport, and export intact", async () => {
  const zip = new JSZip();
  for (const file of DEMO.files) zip.file(file.path, file.content);
  const bundle = `/*${"bundle ".repeat(450000)}*/\n${DEMO.files[1].content}`;
  zip.file("background.js", bundle);
  const assets = [randomBytes(9 * 1024 * 1024), randomBytes(9 * 1024 * 1024)];
  for (const [i, asset] of assets.entries()) zip.file(`asset-${i}.bin`, asset);
  for (let i = 0; i < 600; i++) zip.file(`assets/item-${i}.txt`, `Preserved asset ${i}`);
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  assert.ok(bytes.length > 8 * 1024 * 1024);
  const imported = await importZip(bytes, "large-extension.zip");
  assert.ok(imported.files.length > 400);
  const transported = JSON.stringify({ project: imported, mode: "local" });
  assert.ok(Buffer.byteLength(transported) > 24 * 1024 * 1024);
  const request = new Request("http://localhost/api/migrate", { method: "POST", body: transported });
  const decoded = JSON.parse(new TextDecoder().decode(await boundedBody(request))).project;
  const result = await migrate(validateProject(decoded), "local", () => {});
  assert.equal(result.status, "candidate");
  const exported = await exportZip(imported, result.patches);
  const output = await importZip(exported.bytes, exported.name);
  assert.equal(output.files.find(f => f.path === "background.js")?.content, bundle);
  assert.deepEqual(readManifest(output).permissions, readManifest(DEMO).permissions);
  for (const [i, asset] of assets.entries()) {
    const preserved = Buffer.from(output.files.find(f => f.path === `asset-${i}.bin`)!.content, "base64");
    assert.equal(createHash("sha256").update(preserved).digest("hex"), createHash("sha256").update(asset).digest("hex"));
  }
  assert.equal(output.files.find(f => f.path === "assets/item-599.txt")?.content, "Preserved asset 599");
});
test("ZIPs above the archive byte or entry count limits are still rejected", async () => {
  await assert.rejects(importZip(Buffer.alloc(LIMITS.upload + 1), "oversized.zip"), /100 MB/);
  const zip = new JSZip(); zip.file("manifest.json", DEMO.files[0].content);
  for (let i = 0; i < LIMITS.files; i++) zip.file(`file-${i}.txt`, "x");
  await assert.rejects(importZip(await zip.generateAsync({ type: "nodebuffer" }), "many-files.zip"), /too many entries/);
});
test("AI context includes whole prioritized source and identifies oversized omissions", () => {
  const project = clone();
  project.files.push({ path: "large.js", encoding: "utf8", content: `/*${"x".repeat(AI_SOURCE_CHAR_LIMIT)}*/` });
  project.files.push({ path: "small.js", encoding: "utf8", content: "chrome.tabs.query({}, () => {});" });
  const context = selectAiContext(project, analyze(project));
  assert.ok(context.characters <= AI_SOURCE_CHAR_LIMIT);
  assert.equal(context.files[0].path, "manifest.json");
  assert.ok(context.files.some(f => f.path === "background.js"));
  assert.ok(context.files.some(f => f.path === "small.js"));
  assert.deepEqual(context.omittedPaths, ["large.js"]);
  assert.equal(context.files.find(f => f.path === "small.js")?.content, project.files.at(-1)!.content);
});
test("unsafe paths, duplicate JSON payloads, and invalid binary data are rejected", () => {
  for (const path of ["../x", "/x", "a\\b", "a/./b", "a:b", "a//b", "a\u0000b"]) assert.equal(safePath(path), false);
  const duplicate = clone(); duplicate.files.push({ ...duplicate.files[0] });
  assert.throws(() => validateProject(duplicate), /Duplicate/);
  const binary = clone(); binary.files.push({ path: "icon.png", encoding: "base64", content: "not-base64" });
  assert.throws(() => validateProject(binary), /binary encoding/);
});
test("malformed or unrestricted AI response is rejected", () => {
  assert.throws(() => parseAiJson('{"summary":"ok","unexpected":true}'));
  assert.throws(() => parseAiJson('{"summary":"ok","patches":[{"path":"../x","before":"x","after":"y","reason":"x"}]}'));
  assert.equal(parseAiJson('```json\n{"summary":"ok","patches":[]}\n```').summary, "ok");
});
test("bounded HTTP body cancels oversized streaming input", async () => {
  const request = new Request("http://localhost/api/import", { method: "POST", body: "long payload" });
  await assert.rejects(boundedBody(request, 3), /exceeds upload limits/);
});
test("workspace access requires matching secret and same origin", () => {
  const previous = process.env.BRIDGEFOX_ACCESS_TOKEN; process.env.BRIDGEFOX_ACCESS_TOKEN = "test-workspace-secret";
  try {
    assert.throws(() => authorize(new Request("http://localhost/api/import")), /access password/);
    assert.throws(() => authorize(new Request("http://localhost/api/import", { headers: { "x-bridgefox-access": "test-workspace-secret", origin: "https://other.example" } })), /Cross-origin/);
    authorize(new Request("http://localhost/api/import", { headers: { "x-bridgefox-access": "test-workspace-secret", origin: "http://localhost" } }));
    authorize(new Request("http://localhost:3035/api/import", { headers: { "x-bridgefox-access": "test-workspace-secret", host: "127.0.0.1:3035", origin: "http://127.0.0.1:3035" } }));
    assert.throws(() => authorize(new Request("http://localhost:3035/api/import", { headers: { "x-bridgefox-access": "test-workspace-secret", host: "127.0.0.1:3035", origin: "http://localhost:3035" } })), /Cross-origin/);
  } finally { if (previous === undefined) delete process.env.BRIDGEFOX_ACCESS_TOKEN; else process.env.BRIDGEFOX_ACCESS_TOKEN = previous; }
});
test("public HTTP Host requires workspace access even when the internal URL is localhost", () => {
  const previous = process.env.BRIDGEFOX_ACCESS_TOKEN;
  delete process.env.BRIDGEFOX_ACCESS_TOKEN;
  try {
    assert.throws(() => authorize(new Request("http://localhost/api/import", { headers: { host: "public.example" } })), /workspace publicly/);
  } finally { if (previous !== undefined) process.env.BRIDGEFOX_ACCESS_TOKEN = previous; }
});
test("GitHub import uses one fixed download host and the bounded ZIP pipeline", async () => {
  const previousFetch = globalThis.fetch; const calls: string[] = [];
  const zip = new JSZip(); for (const file of DEMO.files) zip.file(`extension-main/${file.path}`, file.content);
  zip.file("extension-main/large.bin", randomBytes(9 * 1024 * 1024));
  const bytes = await zip.generateAsync({ type: "uint8array" });
  globalThis.fetch = async url => { calls.push(String(url)); return new Response(bytes as BodyInit, { headers: { "Content-Type": "application/zip" } }); };
  try {
    const response = await githubImport(new Request("http://localhost/api/github", { method: "POST", body: JSON.stringify({ url: "https://github.com/owner/extension", branch: "main" }) }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).report.name, "Tab Pocket");
    assert.deepEqual(calls, ["https://codeload.github.com/owner/extension/zip/refs/heads/main"]);
    for (const url of ["http://github.com/owner/extension", "https://github.com.evil.invalid/owner/extension", "https://127.0.0.1/owner/extension", "https://github.com/owner/extension/tree/main"]) {
      const invalid = await githubImport(new Request("http://localhost/api/github", { method: "POST", body: JSON.stringify({ url, branch: "main" }) }));
      assert.equal(invalid.status, 400);
    }
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = previousFetch; }
});

test("Otari workflow uses two roles, fetch, sandbox and real returned usage (mock transport)", async () => {
  const env = { ...process.env }; const previousFetch = globalThis.fetch;
  Object.assign(process.env, { OTARI_BASE_URL: "https://test.otari.invalid/api/v1", OTARI_API_KEY: "test-key", OTARI_ANALYST_MODEL: "test-open-analyst", OTARI_ENGINEER_MODEL: "test-open-engineer", BRIDGEFOX_JOB_BUDGET_USD: ".50", OTARI_GUARDRAIL_PROFILE: "prompt-injection" });
  const calls: { path: string; body: any }[] = [];
  globalThis.fetch = async (url, options) => {
    const path = new URL(String(url)).pathname.replace("/api/v1", ""); const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    calls.push({ path, body });
    assert.equal((options?.headers as Record<string, string>)["Otari-Key"], "test-key");
    const payload = path === "/tools" ? { tools: [{ type: "otari_web_fetch", available: true }, { type: "otari_code_execution", available: true }] } : path === "/fetch" ? { text: "Firefox uses background scripts", url: "https://developer.mozilla.org/", usage: { cost_usd: .001 } } : path === "/code/execute" ? { return_code: 0, stdout: "PASS", usage: { cost_usd: .002 } } : { choices: [{ message: { content: JSON.stringify({ summary: "Safe proposals", risks: [], patches: [] }) } }], model: body.model, usage: { cost_usd: .003 } };
    return Response.json(payload, { headers: { "Otari-Request-ID": `test-${calls.length}`, ...(body?.model ? { "Otari-Model": body.model, "Otari-Fallback": "true", "Otari-Attempt-Count": "2" } : {}) } });
  };
  try {
    const result = await migrate(DEMO, "otari", () => {});
    assert.deepEqual(calls.map(c => c.path), ["/tools", "/fetch", "/chat/completions", "/chat/completions", "/code/execute"]);
    assert.deepEqual(calls.filter(c => c.path === "/chat/completions").map(c => c.body.model), ["test-open-analyst", "test-open-engineer"]);
    assert.equal(calls[2].body.response_format.type, "json_object");
    assert.equal(calls[3].body.response_format, undefined);
    assert.ok(calls[2].body.guardrails[0].on_unavailable === "block");
    assert.ok(calls[4].body.code.startsWith("import json"));
    assert.ok(!calls[4].body.code.includes("chrome.tabs.query"));
    assert.equal(result.costComplete, true); assert.ok(Math.abs(result.spentUsd - .009) < .000001);
    assert.equal(result.activities.filter(a => a.status === "running").length, 0);
    assert.ok(result.activities.some(a => a.fallback));
  } finally { globalThis.fetch = previousFetch; for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); }
});
test("billed unusable analyst output fails the role, retains cost once, and never calls the engineer", async () => {
  const env = { ...process.env }; const previousFetch = globalThis.fetch;
  Object.assign(process.env, { OTARI_BASE_URL: "https://test.otari.invalid/api/v1", OTARI_API_KEY: "test-key", OTARI_ANALYST_MODEL: "a", OTARI_ENGINEER_MODEL: "b" });
  try {
    for (const content of [null, "not valid JSON"]) {
      let completions = 0;
      globalThis.fetch = async url => {
        if (String(url).endsWith("/tools")) return Response.json({ data: [] });
        completions++;
        return Response.json({ choices: [{ message: { content }, finish_reason: "length" }], usage: { cost_usd: ".004", completion_tokens: 3000 } }, { headers: { "Otari-Request-ID": "test-unusable", "Otari-Model": "a" } });
      };
      const result = await migrate(DEMO, "otari", () => {});
      assert.equal(completions, 1);
      assert.equal(result.status, "review");
      assert.equal(result.spentUsd, .004);
      assert.equal(result.costComplete, true);
      const role = result.activities.find(a => a.label === "Compatibility analyst")!;
      assert.equal(role.status, "failed");
      assert.equal(role.requestId, "test-unusable");
      assert.equal((role.data as { finishReason: string }).finishReason, "length");
      if (content === null) assert.match(role.detail, /output token limit/);
      assert.equal(result.activities.some(a => a.label === "Migration engineer"), false);
    }
  } finally { globalThis.fetch = previousFetch; for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); }
});
test("large projects complete a bounded AI review and retain omitted source for manual review", async () => {
  const env = { ...process.env }; const previousFetch = globalThis.fetch;
  Object.assign(process.env, { OTARI_BASE_URL: "https://test.otari.invalid/api/v1", OTARI_API_KEY: "test-key", OTARI_ANALYST_MODEL: "a", OTARI_ENGINEER_MODEL: "b" });
  const project = clone();
  const large = { path: "large.js", encoding: "utf8" as const, content: `/*${"x".repeat(AI_SOURCE_CHAR_LIMIT)}*/` };
  project.files.push(large);
  let completions = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/tools")) return Response.json({ data: [] });
    completions++;
    const body = JSON.parse(String(options?.body));
    const input = JSON.parse(body.messages[1].content);
    assert.equal(input.scope.omittedSourceCount, 1);
    assert.equal(input.files.some((f: { path: string }) => f.path === large.path), false);
    return Response.json({ choices: [{ message: { content: '{"summary":"Supplied files reviewed","patches":[]}' } }], usage: { cost_usd: ".001" } });
  };
  try {
    const result = await migrate(project, "otari", () => {});
    assert.equal(completions, 2);
    assert.equal(result.status, "review");
    assert.equal(result.activities.some(a => a.status === "failed"), false);
    assert.equal(result.validations.find(v => v.name === "AI source coverage")?.status, "review");
    assert.equal(result.project.files.find(f => f.path === large.path)?.content, large.content);
    const exported = await exportZip(project, result.patches);
    assert.equal((await importZip(exported.bytes, exported.name)).files.find(f => f.path === large.path)?.content, large.content);
  } finally { globalThis.fetch = previousFetch; for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); }
});
test("source AI context includes only the real selected manifest and rewrites analysis finding paths", () => {
  const project = clone();
  const path = "src/manifests/chrome/manifest.json";
  project.source = { manifestPath: path, manifestCandidates: [path], buildRequired: true };
  project.files.push({ ...project.files[0], path });
  const report = analyze(project);
  assert.ok(report.findings.some(f => f.file === "manifest.json"));
  const context = selectAiContext(project, report);
  assert.equal(context.files[0].path, path);
  assert.equal(context.files.some(f => f.path === "manifest.json"), false);
  assert.equal(context.findings.findings.some(f => f.file === "manifest.json"), false);
  assert.equal(context.sourceFileCount, project.files.filter(f => f.path !== "manifest.json" && /\.(json|js|html|css)$/.test(f.path)).length);
  project.files[0].content = project.files.at(-1)!.content = " ".repeat(AI_SOURCE_CHAR_LIMIT) + project.files[0].content;
  assert.throws(() => selectAiContext(project, report), /manifest exceeds/);
});
test("both Otari roles use real source paths and validated source patches synchronize the analysis copy", async () => {
  const env = { ...process.env }; const previousFetch = globalThis.fetch;
  Object.assign(process.env, { OTARI_BASE_URL: "https://test.otari.invalid/api/v1", OTARI_API_KEY: "test-key", OTARI_ANALYST_MODEL: "a", OTARI_ENGINEER_MODEL: "b" });
  const project = clone();
  const path = "src/manifests/chrome/manifest.json";
  project.source = { manifestPath: path, manifestCandidates: [path], buildRequired: true };
  project.files.push({ ...project.files[0], path });
  const manifest = readManifest(project);
  manifest.background = { scripts: ["background.js"] };
  const after = JSON.stringify(manifest, null, 2) + "\n";
  let completions = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/tools")) return Response.json({ data: [] });
    completions++;
    const input = JSON.parse(JSON.parse(String(options?.body)).messages[1].content);
    assert.equal(input.files.some((f: { path: string }) => f.path === "manifest.json"), false);
    assert.equal(input.files[0].path, path);
    assert.equal(input.scope.sourceRepository.manifestPath, path);
    assert.equal(input.findings.findings.some((f: { file: string }) => f.file === "manifest.json"), false);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ summary: "Review selected template", patches: completions === 1 ? [] : [{ path, before: project.files[0].content, after, reason: "Use Firefox background scripts" }] }) } }], usage: { cost_usd: ".001" } });
  };
  try {
    const result = await migrate(project, "otari", () => {});
    assert.equal(completions, 2);
    assert.equal(result.status, "review");
    assert.equal(result.activities.some(a => a.status === "failed"), false);
    assert.equal(result.patches[0].path, path);
    assert.equal(result.project.files[0].content, after);
    assert.equal(result.project.files.find(f => f.path === path)?.content, after);
  } finally { globalThis.fetch = previousFetch; for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); }
});
test("AI cannot patch a file omitted from its bounded review", async () => {
  const env = { ...process.env }; const previousFetch = globalThis.fetch;
  Object.assign(process.env, { OTARI_BASE_URL: "https://test.otari.invalid/api/v1", OTARI_API_KEY: "test-key", OTARI_ANALYST_MODEL: "a", OTARI_ENGINEER_MODEL: "b" });
  const project = clone();
  const large = { path: "large.js", encoding: "utf8" as const, content: `/*${"x".repeat(AI_SOURCE_CHAR_LIMIT)}*/` };
  project.files.push(large);
  let calls = 0;
  globalThis.fetch = async url => {
    if (String(url).endsWith("/tools")) return Response.json({ data: [] });
    calls++;
    return Response.json({ choices: [{ message: { content: JSON.stringify({ summary: "Review", patches: calls === 1 ? [] : [{ path: large.path, before: large.content, after: "// removed", reason: "Guess" }] }) } }], usage: { cost_usd: ".001" } });
  };
  try {
    const result = await migrate(project, "otari", () => {});
    assert.equal(result.status, "review");
    assert.equal(result.project.files.find(f => f.path === large.path)?.content, large.content);
    assert.ok(result.activities.some(a => a.status === "failed" && a.detail.includes("outside its review context")));
  } finally { globalThis.fetch = previousFetch; for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); }
});
test("unknown gateway cost stops further paid calls", async () => {
  const env = { ...process.env }; const previousFetch = globalThis.fetch;
  Object.assign(process.env, { OTARI_BASE_URL: "https://test.otari.invalid/api/v1", OTARI_API_KEY: "test-key", OTARI_ANALYST_MODEL: "a", OTARI_ENGINEER_MODEL: "b" });
  let completions = 0;
  globalThis.fetch = async url => {
    if (String(url).endsWith("/tools")) return Response.json({ tools: [] });
    completions++;
    return Response.json({ choices: [{ message: { content: '{"summary":"plan","patches":[]}' } }] });
  };
  try { const result = await migrate(DEMO, "otari", () => {}); assert.equal(completions, 1); assert.equal(result.costComplete, false); assert.equal(result.status, "review"); }
  finally { globalThis.fetch = previousFetch; for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); }
});
test("delayed gateway usage is polled without repeating the paid operation", async () => {
  const env = { ...process.env }; const previousFetch = globalThis.fetch;
  Object.assign(process.env, { OTARI_BASE_URL: "https://test.otari.invalid/api/v1", OTARI_API_KEY: "test-key", OTARI_ANALYST_MODEL: "a", OTARI_ENGINEER_MODEL: "b" });
  let paidCalls = 0, usageReads = 0;
  globalThis.fetch = async url => {
    if (String(url).includes("/usage/requests/")) { usageReads++; return usageReads === 1 ? Response.json({}, { status: 404 }) : Response.json({ cost_usd: ".004" }); }
    paidCalls++; return Response.json({ text: "Firefox documentation" }, { headers: { "Otari-Request-ID": "test-delayed" } });
  };
  try { const response = await gatewayCall("/fetch", { url: "https://developer.mozilla.org/" }, "Fetch"); assert.equal(paidCalls, 1); assert.equal(usageReads, 2); assert.equal(response.activity.costUsd, .004); }
  finally { globalThis.fetch = previousFetch; for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); }
});
test("402 error stops the workflow without retries or fabricated success", async () => {
  const env = { ...process.env }; const previousFetch = globalThis.fetch;
  Object.assign(process.env, { OTARI_BASE_URL: "https://test.otari.invalid/api/v1", OTARI_API_KEY: "test-key", OTARI_ANALYST_MODEL: "a", OTARI_ENGINEER_MODEL: "b" });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ error: "budget_exceeded" }, { status: 402 }); };
  try { const result = await migrate(DEMO, "otari", () => {}); assert.equal(calls, 1); assert.equal(result.status, "review"); assert.ok(result.activities.some(a => a.status === "failed" && a.detail.includes("402"))); }
  finally { globalThis.fetch = previousFetch; for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); }
});
