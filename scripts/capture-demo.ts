import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
const base = process.env.BRIDGEFOX_TEST_URL ?? "https://bridgefox.vercel.app";
const out = "demo-video/assets/footage";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, recordVideo: { dir: out, size: { width: 1600, height: 900 } }, acceptDownloads: true });
const page = await context.newPage();
const origin = performance.now();
const scenes: { id: string; mediaStart: number; duration: number }[] = [];
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));
const shot = async (id: string, action: () => Promise<unknown>) => {
  const start = performance.now();
  scenes.push({ id, mediaStart: (start - origin) / 1000, duration: 24 });
  await action();
  const remaining = 24000 - (performance.now() - start);
  if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
  console.log(`Captured ${id}`);
};
try {
  await page.goto(base);
  await page.getByRole("heading", { name: "Chrome extensions. Firefox freedom." }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("button", { name: "Pause animations", exact: true }).click();
  await shot("intro", async () => { await page.mouse.move(1000, 600); });
  await shot("import", async () => {
    await page.getByLabel("Choose extension source ZIP").setInputFiles("public/examples/tab-pocket-chrome.zip");
    await page.getByRole("heading", { name: "Tab Pocket" }).waitFor();
  });
  await shot("report", async () => {
    await page.getByRole("tab", { name: /API compatibility/ }).click();
    await page.waitForTimeout(5500);
    await page.getByRole("tab", { name: /Permissions/ }).click();
    await page.waitForTimeout(5500);
    await page.getByRole("tab", { name: /Findings/ }).click();
  });
  await shot("migration", async () => {
    await page.getByRole("button", { name: "Generate migration", exact: true }).click();
    await page.getByText("Proposals ready for review", { exact: true }).waitFor();
  });
  await shot("review", async () => {
    await page.getByRole("button", { name: "Unified", exact: true }).click();
    await page.waitForTimeout(6500);
    await page.getByRole("button", { name: "Split", exact: true }).click();
    await page.getByLabel("Search source files").fill("background");
    await page.locator(".file-tree > button").click();
    await page.waitForTimeout(6500);
    await page.getByLabel("Search source files").fill("");
    await page.locator(".file-tree > button").filter({ hasText: "manifest.json" }).click();
  });
  // This document displays retained evidence, never a fabricated app result.
  const evidence = await readFile("docs/evidence/otari-migration-2026-11-06.json", "utf8");
  await shot("otari", async () => {
    await page.evaluate(text => {
      const dialog = document.createElement("dialog");
      dialog.id = "recorded-evidence";
      Object.assign(dialog.style, { width: "1250px", height: "730px", padding: "32px", background: "#f6f4ed", color: "#26312c", border: "1px solid #bdc3b8", borderRadius: "18px" });
      const title = document.createElement("h1"); title.textContent = "Retained Otari evidence · November 6, 2026";
      const note = document.createElement("p"); note.textContent = "Original saved gateway report. This recording does not replay a paid request.";
      const source = document.createElement("pre"); source.textContent = text;
      Object.assign(source.style, { fontSize: "16px", lineHeight: "1.5", height: "570px", overflow: "auto", marginTop: "22px", whiteSpace: "pre-wrap" });
      dialog.append(title, note, source); document.body.append(dialog); dialog.showModal();
    }, evidence);
    await page.waitForTimeout(10000);
    await page.locator("#recorded-evidence pre").evaluate(element => element.scrollTop = 550);
  });
  await page.evaluate(() => document.querySelector("#recorded-evidence")?.remove());
  await shot("export", async () => {
    await page.getByRole("button", { name: "Review & export", exact: true }).click();
    await page.getByRole("heading", { name: "Validation results" }).waitFor();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download Firefox ZIP", exact: true }).click()]);
    await download.saveAs("artifacts/demo-video/Tab-Pocket-firefox.zip");
    await page.getByRole("heading", { name: /Firefox runtime/ }).scrollIntoViewIfNeeded();
  });
  await shot("closing", async () => { await page.goto(base); await page.getByRole("heading", { name: "Chrome extensions. Firefox freedom." }).waitFor(); });
  if (errors.length) throw new Error(errors.join("; "));
} finally {
  const video = page.video();
  await context.close();
  if (video) await video.saveAs(`${out}/bridgefox-browser.webm`);
  await browser.close();
}
await writeFile(`${out}/capture.json`, JSON.stringify({ base, scenes, errors, liveOtariCalls: 0 }, null, 2) + "\n");
