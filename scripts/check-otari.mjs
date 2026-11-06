import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseEnv } from "node:util";

if (process.argv[2] !== "--run") {
  throw new Error("This makes paid Otari calls. Run explicitly with --run after checking gateway funds and the job threshold.");
}
const base = process.env.BRIDGEFOX_TEST_URL || "http://127.0.0.1:3035";
const env = parseEnv(await readFile(".env.local", "utf8"));
const headers = { "Content-Type": "application/json", ...(env.BRIDGEFOX_ACCESS_TOKEN ? { "x-bridgefox-access": env.BRIDGEFOX_ACCESS_TOKEN } : {}) };
const directory = `artifacts/otari/${new Date().toISOString().replace(/[:.]/g, "-")}`;
await mkdir(directory, { recursive: true });
const demoResponse = await fetch(`${base}/api/demo`, { method: "POST", headers });
if (!demoResponse.ok) throw new Error(`Demo import returned ${demoResponse.status}`);
const { project } = await demoResponse.json();
await writeFile(`${directory}/original.json`, JSON.stringify(project, null, 2) + "\n");
// One migration request, with no automatic retry on interruption or uncertainty.
const response = await fetch(`${base}/api/migrate`, {
  method: "POST", headers, body: JSON.stringify({ project, mode: "otari" }),
  signal: AbortSignal.timeout(300000)
});
if (!response.ok || !response.body) throw new Error(`Migration returned ${response.status}`);
let pending = "", transcript = "", result;
const decoder = new TextDecoder();
for await (const chunk of response.body) {
  pending += decoder.decode(chunk, { stream: true });
  let index;
  while ((index = pending.indexOf("\n")) >= 0) {
    const line = pending.slice(0, index); pending = pending.slice(index + 1);
    if (!line.trim()) continue;
    transcript += line + "\n";
    await writeFile(`${directory}/events.ndjson`, transcript);
    const event = JSON.parse(line);
    if (event.type === "activity") console.log(JSON.stringify(event.activity));
    if (event.type === "error") throw new Error(event.message);
    if (event.type === "result") result = event.result;
  }
}
if (!result) throw new Error(`No migration result; inspect ${directory}/events.ndjson before retrying.`);
await writeFile(`${directory}/migration.json`, JSON.stringify(result, null, 2) + "\n");
const exportResponse = await fetch(`${base}/api/export`, { method: "POST", headers, body: JSON.stringify({ original: project, patches: result.patches }) });
if (!exportResponse.ok) throw new Error(`Export returned ${exportResponse.status}; migration result retained.`);
const zip = Buffer.from(await exportResponse.arrayBuffer());
await writeFile(`${directory}/tab-pocket-firefox.zip`, zip);
const roles = result.activities.filter(a => ["Compatibility analyst", "Migration engineer"].includes(a.label) && a.origin === "otari");
const evidence = {
  checkedAt: new Date().toISOString(), directory, mode: result.mode, status: result.status,
  spentUsd: result.spentUsd, costComplete: result.costComplete, budgetUsd: result.budgetUsd,
  original: "Authored MIT Tab Pocket fixture", patches: result.patches.map(p => ({ path: p.path, origin: p.origin, reason: p.reason })),
  activities: result.activities, validations: result.validations,
  distinctResolvedModels: roles.length === 2 && roles.every(a => a.status === "complete" && a.model) && new Set(roles.map(a => a.model)).size === 2,
  export: { bytes: zip.length, sha256: createHash("sha256").update(zip).digest("hex") },
  scope: "One real migration through the local Next.js API; runtime compatibility needs a separate Firefox check."
};
await writeFile(`${directory}/checks.json`, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ directory, status: result.status, spentUsd: result.spentUsd, costComplete: result.costComplete, distinctResolvedModels: evidence.distinctResolvedModels }, null, 2));
if (!evidence.distinctResolvedModels || !result.costComplete || result.activities.some(a => a.status === "failed")) {
  throw new Error("Hosted workflow is incomplete. Evidence retained; no paid request was retried.");
}
