import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const base = process.env.BRIDGEFOX_TEST_URL || "http://127.0.0.1:3035";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
let interruptedRequests = 0;
const directory = "artifacts/network-error";
await mkdir(directory, { recursive: true });
try {
  await page.goto(base);
  await page.waitForFunction(() => !!document.documentElement.dataset.motion);
  await page.getByRole("button", { name: "Pause animations", exact: true }).click();
  await page.getByRole("button", { name: "Load Tab Pocket", exact: true }).click();
  await page.getByRole("heading", { name: "Tab Pocket", exact: true }).waitFor();
  await page.getByRole("radio", { name: /Otari AI/ }).click();
  // Abort before the request reaches the app. This sends no paid operation.
  await page.route("**/api/migrate", async route => {
    assert.equal(route.request().postDataJSON().mode, "otari");
    interruptedRequests++;
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Generate migration", exact: true }).click();
  const alert = page.getByRole("alert").filter({ hasText: "The connection to BridgeFox was interrupted." });
  await alert.waitFor();
  assert.match(await alert.innerText(), /check gateway usage before starting another AI job/);
  await page.getByRole("button", { name: "Generate changes", exact: true }).waitFor();
  assert.equal(interruptedRequests, 1);
  assert.equal(await page.getByRole("heading", { name: "Tab Pocket", exact: true }).count(), 1);
  await page.screenshot({ path: `${directory}/interrupted-ai.png`, fullPage: true });
  const evidence = { checkedAt: new Date().toISOString(), interruptedAiRequest: true, actionableMessage: true, sourceRetained: true, busyStateCleared: true, automaticRetries: 0, paidOperations: 0, scope: "Browser request deliberately aborted before reaching BridgeFox; no real Otari job or billing verification." };
  await writeFile(`${directory}/checks.json`, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
} finally { await browser.close(); }
