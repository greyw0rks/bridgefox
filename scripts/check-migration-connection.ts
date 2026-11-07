import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, firefox } from "@playwright/test";

const mode = process.argv.includes("--run") ? "otari" : "local";
const engine = process.argv.includes("--firefox") ? firefox : chromium;
const base = process.env.BRIDGEFOX_TEST_URL || "http://localhost:3035";
const directory = `artifacts/migration-connection/${new Date().toISOString().replace(/[:.]/g, "-")}`;
await mkdir(directory, { recursive: true });
process.env.LD_LIBRARY_PATH = `/tmp/bridgefox-browser-deps/root/usr/lib/x86_64-linux-gnu${process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : ""}`;
const browser = await engine.launch({ headless: true });
const page = await browser.newPage();
const errors: string[] = [];
const requests: unknown[] = [];
let requestCount = 0;
let clickedAt = 0;
let timeToHeadersMs: number | undefined;
// Observe the same events the app parses. Firefox's inspection protocol evicts
// large response bodies; retaining a second complete repository is unnecessary.
await page.addInitScript(() => {
  const parse = JSON.parse;
  const events: unknown[] = [];
  (window as any).__bridgefoxConnectionEvents = events;
  JSON.parse = (...args: Parameters<typeof JSON.parse>) => {
    const event = parse(...args);
    if (event?.type === "activity" && event.activity?.timestamp) {
      events.push({ ...event, receivedAt: Date.now() });
    } else if (event?.type === "result" && event.result?.project && event.result?.report) {
      const { spentUsd, costComplete, status, activities } = event.result;
      const summary = { spentUsd, costComplete, status, activities };
      events.push({ type: "result", result: summary, receivedAt: Date.now() });
      (window as any).__bridgefoxConnectionResult = summary;
    } else if (event?.type === "error" && typeof event.message === "string") {
      events.push({ ...event, receivedAt: Date.now() });
    }
    return event;
  };
});
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
page.on("requestfailed", request => requests.push({ url: request.url(), failure: request.failure()?.errorText }));
page.on("request", request => { if (request.url().endsWith("/api/migrate")) { assert.equal(request.postDataJSON().mode, mode); requestCount++; } });
page.on("response", response => {
  if (!response.url().endsWith("/api/migrate")) return;
  timeToHeadersMs = Date.now() - clickedAt;
  requests.push({ url: response.url(), status: response.status(), headers: response.headers() });
});
try {
  await page.goto(base);
  await page.waitForFunction(() => !!document.documentElement.dataset.motion);
  await page.getByRole("button", { name: "Pause animations", exact: true }).click();
  const archiveIndex = process.argv.indexOf("--archive");
  if (archiveIndex !== -1) {
    await page.locator('input[type="file"]').setInputFiles(process.argv[archiveIndex + 1]);
    await page.getByRole("combobox", { name: /Manifest for analysis/ }).waitFor({timeout:120000});
  } else {
    await page.getByRole("button", { name: "Load Tab Pocket", exact: true }).click();
    await page.getByRole("heading", { name: "Tab Pocket", exact: true }).waitFor();
  }
  if (mode === "otari") await page.getByRole("radio", { name: /Otari AI/ }).click();
  clickedAt = Date.now();
  await page.getByRole("button", { name: "Generate migration", exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector(".error-banner") || document.body.innerText.includes("Proposals ready for review"), undefined, { timeout: 300000 });
  const { result, events } = await page.evaluate(() => ({ result: (window as any).__bridgefoxConnectionResult, events: (window as any).__bridgefoxConnectionEvents }));
  await writeFile(`${directory}/event-summaries.json`, JSON.stringify(events, null, 2) + "\n");
  const alert = await page.locator(".error-banner").allTextContents();
  const activities = await page.locator(".activity-item h4").allTextContents();
  const timeToActivityMs = events.find((e: any) => e.type === "activity")?.receivedAt - clickedAt;
  const evidence = { checkedAt: new Date().toISOString(), base, browser: engine.name(), mode, requestCount, timeToHeadersMs, timeToActivityMs, elapsedMs: Date.now() - clickedAt, requests, errors, alert, activities, spentUsd: result?.spentUsd, costComplete: result?.costComplete, status: result?.status, roles: result?.activities.filter((a: any) => a.origin === "otari").map((a: any) => ({ label: a.label, status: a.status, requestId: a.requestId, costUsd: a.costUsd, model: a.model, detail: a.detail })), directory };
  await writeFile(`${directory}/checks.json`, JSON.stringify(evidence, null, 2) + "\n");
  await page.screenshot({ path: `${directory}/studio.png`, fullPage: true });
  console.log(JSON.stringify(evidence, null, 2));
  assert.equal(requestCount, 1);
  assert.deepEqual(alert, []);
  assert.deepEqual(errors, []);
  assert.ok(result, "Migration must finish with a retained result");
  assert.ok(timeToHeadersMs !== undefined && timeToHeadersMs < 5000, "Migration acknowledgement must arrive within five seconds");
  assert.ok(timeToActivityMs < 5000, "The app must display the first real activity within five seconds");
} finally { await browser.close(); }
