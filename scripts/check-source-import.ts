import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import JSZip from "jszip";
import { chromium } from "@playwright/test";

const archive = process.argv[2];
if (!archive) throw new Error("Usage: npm run check:source-import -- /path/to/source.zip");
const base = process.env.BRIDGEFOX_TEST_URL || "http://127.0.0.1:3035";
const directory = "artifacts/source-import";
await mkdir(directory, { recursive: true });
const progress = async (stage: string) => writeFile(`${directory}/progress.json`, JSON.stringify({ stage, at: new Date().toISOString() }));
await progress("Reading source archive");
const inputBytes = await readFile(archive);
const input = await JSZip.loadAsync(inputBytes);
const inputFiles = Object.values(input.files).filter(f => !f.dir);
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const expected = new Map<string, { bytes: number; sha256: string }>();
const prefix = inputFiles[0].name.split("/")[0] + "/";
assert.ok(inputFiles.every(f => f.name.startsWith(prefix)), "Expected one repository wrapper directory");
for (const file of inputFiles) {
  const bytes = await file.async("nodebuffer");
  expected.set(file.name.slice(prefix.length), { bytes: bytes.length, sha256: sha(bytes) });
}
await progress("Archive hashes recorded");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
page.setDefaultTimeout(120000);
const errors: string[] = [];
const requests: { url: string; status?: number; error?: string }[] = [];
let migrations = 0;
const projectRequestBytes: Record<string, number> = {};
page.on("pageerror", e => errors.push(e.message));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
page.on("response", response => { if (response.url().includes("/api/")) requests.push({ url: response.url(), status: response.status() }); });
page.on("requestfailed", request => requests.push({ url: request.url(), error: request.failure()?.errorText }));
page.on("request", request => {
  const endpoint = request.url().split("/").at(-1)!;
  if (["analyze", "migrate", "export"].includes(endpoint)) projectRequestBytes[endpoint] = request.postDataBuffer()?.length ?? 0;
  if (request.url().endsWith("/api/migrate")) {
    assert.ok(projectRequestBytes.migrate < 1024, "Migration must use a project reference");
    assert.equal(request.postDataJSON().mode, "local", "This check must not send paid operations");
    migrations++;
  }
});
try {
  await page.goto(base);
  await page.waitForFunction(() => !!document.documentElement.dataset.motion);
  await page.getByRole("button", { name: "Pause animations", exact: true }).click();
  const imported = page.waitForResponse(response => response.url().endsWith("/api/import"), { timeout: 120000 });
  await page.locator('input[type="file"]').setInputFiles(archive);
  await progress("ZIP uploaded; waiting for response");
  const importResponse = await imported;
  assert.equal(importResponse.status(), 200, importResponse.ok() ? "" : await importResponse.text());
  await progress("Import responded; waiting for studio");
  const selector = page.getByRole("combobox", { name: /Manifest for analysis/ });
  await selector.waitFor({ timeout: 120000 });
  assert.equal(await selector.inputValue(), "src/manifest/chrome-mv3/manifest.json");
  assert.equal(await selector.locator("option").count(), 3);
  await progress("Source report rendered; selecting Firefox manifest");
  const reanalyzed = page.waitForResponse(response => response.url().endsWith("/api/analyze"));
  assert.equal(await selector.isEnabled(), true);
  await selector.selectOption("src/manifest/firefox-mv2/manifest.json", { force: true });
  assert.equal((await reanalyzed).status(), 200);
  await progress("Manifest selection responded");
  await page.getByText("Manifest V2", { exact: false }).waitFor({ timeout: 120000 });
  assert.equal(await page.getByRole("radio", { name: /Local rules/ }).getAttribute("aria-checked"), "true", "This check must use free local rules");
  await page.getByRole("button", { name: "Generate migration", exact: true }).click();
  await progress("Local migration requested");
  await page.getByText("Proposals ready for review", { exact: true }).waitFor({ timeout: 120000 });
  assert.equal(migrations, 1);
  await progress("Local migration rendered");
  assert.ok(await page.locator(".file-tree > button").count() <= 100, "File list must be bounded");
  await page.getByRole("button", { name: "Next source files", exact: true }).click();
  await page.getByText(`101–200 of ${expected.size + 1}`, { exact: true }).waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Source repository view overflows at ${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Review & export", exact: true }).click();
  await progress("Export view opened");
  await page.getByRole("heading", { name: "Build before installing.", exact: true }).waitFor();
  const download = page.waitForEvent("download", { timeout: 120000 });
  await page.getByRole("button", { name: "Download reviewed source ZIP", exact: true }).click();
  const downloaded = await download;
  assert.match(downloaded.suggestedFilename(), /-reviewed-source.zip$/);
  await downloaded.saveAs(`${directory}/reviewed-source.zip`);
  await progress("Source ZIP downloaded; checking hashes");
  await page.screenshot({ path: `${directory}/source-export.png`, fullPage: true });
  const output = await JSZip.loadAsync(await readFile(`${directory}/reviewed-source.zip`));
  const outputFiles = Object.values(output.files).filter(f => !f.dir);
  assert.equal(output.file("manifest.json"), null, "The analysis manifest must not become a build artifact");
  assert.equal(outputFiles.length, expected.size);
  for (const file of outputFiles) {
    const preserved = expected.get(file.name);
    assert.ok(preserved, `Unexpected output file ${file.name}`);
    const bytes = await file.async("nodebuffer");
    assert.equal(bytes.length, preserved.bytes, file.name);
    assert.equal(sha(bytes), preserved.sha256, file.name);
  }
  assert.deepEqual(errors, []);
  assert.ok(Object.values(projectRequestBytes).every(bytes => bytes < 2048), "Project actions must not retransmit archive assets");
  const largest = [...expected.entries()].sort((a, b) => b[1].bytes - a[1].bytes)[0];
  const evidence = {
    checkedAt: new Date().toISOString(), archive: basename(archive), zipBytes: inputBytes.length,
    fileCount: expected.size, extractedBytes: [...expected.values()].reduce((n, f) => n + f.bytes, 0),
    largestFile: { path: largest[0], ...largest[1] }, manifestCandidates: 3,
    defaultManifest: "src/manifest/chrome-mv3/manifest.json", selectedManifest: "src/manifest/firefox-mv2/manifest.json",
    browserUploadPassed: true, selectionReanalyzed: true, sourceExportPassed: true,
    allFilesHashMatched: true, virtualManifestExcluded: true, mobileAndDesktopWithoutOverflow: true,
    mode: "local", paidOtariCalls: 0, repositoryScriptsExecuted: false, runtimeTested: false,
    pageErrors: errors, requests, projectRequestBytes, fileBrowserPaginated: true, scope: "Source import and preservation only; Rabby is not built, migrated or runtime-verified by this check.",
  };
  await writeFile(`${directory}/checks.json`, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  await page.screenshot({ path: `${directory}/failure.png`, timeout: 5000 }).catch(() => {});
  await writeFile(`${directory}/failure.json`, JSON.stringify({ error: String(error), errors, requests, alerts: await page.getByRole("alert").allTextContents(), text: (await page.locator("body").innerText()).slice(-10000) }, null, 2));
  throw error;
} finally { await browser.close(); }
