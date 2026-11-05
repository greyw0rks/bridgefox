import { randomUUID } from "node:crypto";
import type { Activity } from "./types";

export function otariConfig() {
  const raw = process.env.OTARI_BASE_URL?.trim().replace(/\/$/, "");
  const analyst = process.env.OTARI_ANALYST_MODEL?.trim();
  const engineer = process.env.OTARI_ENGINEER_MODEL?.trim();
  const key = process.env.OTARI_API_KEY?.trim();
  const parsedBudget = Number(process.env.BRIDGEFOX_JOB_BUDGET_USD ?? "0.50");
  const budget = Number.isFinite(parsedBudget) && parsedBudget > 0 && parsedBudget <= 10 ? parsedBudget : 0.50;
  return { baseUrl: raw, key, analyst, engineer, budget, guardrail: process.env.OTARI_GUARDRAIL_PROFILE?.trim(), configured: Boolean(raw && key && analyst && engineer && analyst !== engineer) };
}
export function publicConfig() {
  const c = otariConfig();
  return { configured: c.configured, analyst: c.analyst ?? null, engineer: c.engineer ?? null, budgetUsd: c.budget, guardrail: c.guardrail ?? null, accessRequired: Boolean(process.env.BRIDGEFOX_ACCESS_TOKEN), features: { webFetch: "checked on connection", sandbox: "checked on connection", routing: "configured in Otari", budgets: "configure an Otari key spend ceiling" } };
}
export type GatewayResponse = { body: Record<string, any>; activity: Activity };
export class GatewayError extends Error { constructor(message: string, public activity: Activity) { super(message); } }
export async function gatewayCall(path: string, body: unknown | undefined, label: string, signal?: AbortSignal): Promise<GatewayResponse> {
  const config = otariConfig();
  if (!config.configured || !config.baseUrl || !config.key) throw new Error("Configure the hosted Otari URL, API key, and two distinct model IDs first");
  const url = new URL(config.baseUrl);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Otari requires HTTPS (or localhost for development)");
  if (url.username || url.password || url.search || url.hash) throw new Error("Use a clean Otari API base URL");
  const id = randomUUID();
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST", redirect: "error",
      headers: { "Otari-Key": config.key, "Content-Type": "application/json", ...(body !== undefined && path === "/chat/completions" ? { "Idempotency-Key": id } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000), cache: "no-store"
    });
  } catch {
    throw new GatewayError("Otari could not be reached or the request timed out. No automatic retry was made; check gateway usage before retrying.", { id, label, origin: "otari", status: "failed", timestamp: new Date().toISOString(), detail: "Connection ended without a response; spend may be unknown." });
  }
  let data: Record<string, any>;
  try { data = await response.json(); } catch { data = {}; }
  let cost = data.usage?.cost_usd;
  const requestId = response.headers.get("Otari-Request-ID") ?? undefined;
  // Direct fetch/execute and failed requests may omit inline usage. Ask Otari's actual usage record.
  if (cost == null && requestId && body !== undefined) {
    // Usage settlement is asynchronous. Poll only the read endpoint, never the paid operation.
    for (const delay of [0, 250, 500, 1000]) {
      if (signal?.aborted) break;
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      try {
        const usage = await fetch(`${config.baseUrl}/usage/requests/${encodeURIComponent(requestId)}`, { headers: { "Otari-Key": config.key }, redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000), cache: "no-store" });
        if (usage.ok) { cost = (await usage.json()).cost_usd; break; }
        if (usage.status !== 404) break;
      } catch { break; /* An unavailable cost stays unknown; it never becomes zero. */ }
    }
  }
  const costUsd = cost !== null && cost !== undefined && Number.isFinite(Number(cost)) && Number(cost) >= 0 ? Number(cost) : undefined;
  const activity: Activity = {
    id, label, status: response.ok ? "complete" : "failed", origin: "otari", timestamp: new Date().toISOString(), requestId, costUsd,
    model: response.headers.get("Otari-Model") ?? data.model ?? undefined,
    fallback: response.headers.get("Otari-Fallback") === "true", attempts: Number(response.headers.get("Otari-Attempt-Count")) || undefined,
    data: { guardrails: response.headers.get("Otari-Guardrails") ?? undefined, provider: response.headers.get("Otari-Provider") ?? undefined },
    detail: response.ok ? `Otari responded in ${((Date.now() - started) / 1000).toFixed(1)}s.` : `Otari returned HTTP ${response.status}${response.headers.get("Otari-Error-Code") ? ` (${response.headers.get("Otari-Error-Code")})` : ""}. ${response.status === 402 ? "Check account funds, key budget, and model/tool pricing." : "Check the account's model, tool and guardrail settings."}`
  };
  if (!response.ok) throw new GatewayError(activity.detail, activity);
  return { body: data, activity };
}
export function completionText(body: Record<string, any>): string {
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("Otari model returned no text response");
  return content;
}
