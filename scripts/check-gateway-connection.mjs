import { readFile, mkdir, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";

const env = parseEnv(await readFile(".env.local", "utf8"));
const base = env.OTARI_BASE_URL?.trim().replace(/\/$/, "");
if (!base || !env.OTARI_API_KEY) throw new Error("Configure Otari first");
const result = { checkedAt: new Date().toISOString(), paidOperations: 0, scope: "Read-only gateway tool discovery; no model, fetch tool, sandbox or migration requests." };
try {
  const response = await fetch(`${base}/tools`, {
    headers: { "Otari-Key": env.OTARI_API_KEY.trim() }, redirect: "error", signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  const entries = Array.isArray(data) ? data : data.tools ?? data.data ?? [];
  Object.assign(result, {
    reachable: true, status: response.status, authenticated: response.ok,
    tools: (Array.isArray(entries) ? entries : []).map(tool => ({ type: tool.type ?? tool.name ?? tool.id, available: tool.available, reason: tool.reason })),
  });
} catch (error) {
  Object.assign(result, { reachable: false, error: error.message, code: error.cause?.code });
}
await mkdir("artifacts/connection", { recursive: true });
await writeFile("artifacts/connection/checks.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
if (!result.authenticated) process.exitCode = 1;
