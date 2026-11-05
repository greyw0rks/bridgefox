import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { importZip, safePath, validateProject } from "../src/lib/archive";
import { analyze, apiSupport, readManifest } from "../src/lib/analyzer";
import { DEMO } from "../src/lib/demo";
import { migrate } from "../src/lib/migrate";
import { exportZip } from "../src/lib/export";
import { applyPatches, deterministicPatches, parseAiJson } from "../src/lib/patches";
import { authorize, boundedBody } from "../src/lib/http";
import { POST as githubImport } from "../src/app/api/github/route";
import { gatewayCall } from "../src/lib/otari";
import type { Patch, Project } from "../src/lib/types";

const clone = () => structuredClone(DEMO);
function changeManifest(project: Project, change: (manifest: Record<string, any>) => void) { const m = readManifest(project); change(m); project.files[0].content = JSON.stringify(m); return project; }
function patch(project: Project, path: string, after: string): Patch { return { path, before: project.files.find(f => f.path === path)!.content, after, reason: "Test migration proposal", origin: "otari" }; }

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
    if (kind === "oversized") zip.file("giant.js", "x".repeat(2 * 1024 * 1024 + 1));
    await assert.rejects(importZip(await zip.generateAsync({ type: "nodebuffer", platform: "UNIX", compression: "DEFLATE" }), "unsafe.zip"));
  }
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
  } finally { if (previous === undefined) delete process.env.BRIDGEFOX_ACCESS_TOKEN; else process.env.BRIDGEFOX_ACCESS_TOKEN = previous; }
});
test("GitHub import uses one fixed download host and the bounded ZIP pipeline", async () => {
  const previousFetch = globalThis.fetch; const calls: string[] = [];
  const zip = new JSZip(); for (const file of DEMO.files) zip.file(`extension-main/${file.path}`, file.content);
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
    assert.ok(calls[2].body.guardrails[0].on_unavailable === "block");
    assert.ok(calls[4].body.code.startsWith("import json"));
    assert.ok(!calls[4].body.code.includes("chrome.tabs.query"));
    assert.equal(result.costComplete, true); assert.ok(Math.abs(result.spentUsd - .009) < .000001);
    assert.equal(result.activities.filter(a => a.status === "running").length, 0);
    assert.ok(result.activities.some(a => a.fallback));
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
