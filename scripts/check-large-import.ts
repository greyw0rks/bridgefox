import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";
import { chromium } from "@playwright/test";
import { DEMO } from "../src/lib/demo";

const base = process.env.BRIDGEFOX_TEST_URL || "http://127.0.0.1:3035";
const directory = "artifacts/large-import";
await mkdir(directory, { recursive: true });
const zip = new JSZip();
for (const file of DEMO.files) zip.file(file.path, file.content);
const bundle = `/*${"bundle ".repeat(450000)}*/\n${DEMO.files[1].content}`;
zip.file("background.js", bundle);
const assets = [randomBytes(9 * 1024 * 1024), randomBytes(9 * 1024 * 1024)];
for (const [i, asset] of assets.entries()) zip.file(`asset-${i}.bin`, asset);
for (let i = 0; i < 600; i++) zip.file(`assets/item-${i}.txt`, `Preserved asset ${i}`);
const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
assert.ok(bytes.length > 8 * 1024 * 1024);
await writeFile(`${directory}/source.zip`, bytes);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const errors: string[] = [];
const migrationRequests: number[] = [];
const requests: { url: string; status?: number; error?: string }[] = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
page.on("response", response => { if (response.url().includes("/api/")) requests.push({ url: response.url(), status: response.status() }); });
page.on("requestfailed", request => requests.push({ url: request.url(), error: request.failure()?.errorText }));
page.on("request", request => {
  if (request.url().endsWith("/api/migrate")) {
    assert.equal(request.postDataJSON().mode, "local", "This verification must not make paid calls");
    migrationRequests.push(request.postDataBuffer()?.length || 0);
  }
});
try {
  await page.goto(base);
  await page.waitForFunction(() => !!document.documentElement.dataset.motion);
  await page.getByRole("button", { name: "Pause animations", exact: true }).click();
  await page.getByText(".ZIP FILES · UP TO 100 MB", { exact: true }).waitFor();
  const imported = page.waitForResponse(response => response.url().endsWith("/api/import"), { timeout: 120000 });
  await page.locator('input[type="file"]').setInputFiles(`${directory}/source.zip`);
  const importResponse = await imported;
  assert.equal(importResponse.status(), 200, importResponse.ok() ? "" : await importResponse.text());
  await page.getByRole("heading", { name: "Tab Pocket", exact: true }).waitFor({ timeout: 120000 });
  await page.getByRole("button", { name: "Generate migration", exact: true }).click();
  await page.getByText("Proposals ready for review", { exact: true }).waitFor({ timeout: 120000 });
  assert.equal(migrationRequests.length, 1);
  assert.ok(migrationRequests[0] < 1024, "Migration must use a project reference rather than retransmitting binary assets");
  await page.getByLabel("Search source files").fill("background.js");
  await page.getByRole("button", { name: /background\.js/ }).click();
  await page.getByText("Large file preview. The complete source stays in your export.").first().waitFor();
  assert.ok((await page.getByLabel("Original Chrome source").textContent() || "").length <= 50000);
  const sourceDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download complete file", exact: true }).first().click();
  const sourceDownload = await sourceDownloadPromise;
  await sourceDownload.saveAs(`${directory}/downloaded-background.js`);
  assert.equal(await readFile(`${directory}/downloaded-background.js`, "utf8"), bundle);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Large source overflows at ${width}`);
  }
  await page.screenshot({ path: `${directory}/large-source-preview.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Review & export", exact: true }).click();
  const downloadPromise = page.waitForEvent("download", { timeout: 120000 });
  await page.getByRole("button", { name: "Download Firefox ZIP", exact: true }).click();
  await (await downloadPromise).saveAs(`${directory}/firefox.zip`);
  const output = await JSZip.loadAsync(await readFile(`${directory}/firefox.zip`));
  assert.equal(await output.file("background.js")!.async("string"), bundle);
  const sha = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
  for (const [i, asset] of assets.entries()) assert.equal(sha(await output.file(`asset-${i}.bin`)!.async("nodebuffer")), sha(asset));
  assert.equal(await output.file("assets/item-599.txt")!.async("string"), "Preserved asset 599");
  assert.deepEqual(JSON.parse(await output.file("manifest.json")!.async("string")).permissions, JSON.parse(DEMO.files[0].content).permissions);
  assert.deepEqual(errors, []);
  const evidence = { checkedAt: new Date().toISOString(), inputZipBytes: bytes.length, inputFiles: Object.keys(zip.files).filter(path => !zip.files[path].dir).length, largeSourceBytes: Buffer.byteLength(bundle), migrationRequestBytes: migrationRequests[0], previewBounded: true, fullSourceDownloadMatches: true, mobileAndDesktopWithoutOverflow: true, exportAssetsMatch: true, permissionsPreserved: true, pageErrors: errors, mode: "local", paidOtariCalls: 0, scope: "Actual browser upload, Next.js migration/export endpoints, source download and exact output checks; no Firefox runtime or live Otari verification." };
  await writeFile(`${directory}/checks.json`, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  await page.screenshot({ path: `${directory}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${directory}/failure.json`, JSON.stringify({ error: String(error), pageErrors: errors, requests, alerts: await page.getByRole("alert").allTextContents(), text: (await page.locator("body").innerText()).slice(-10000) }, null, 2));
  throw error;
} finally { await browser.close(); }
