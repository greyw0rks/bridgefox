import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
const base = process.env.BRIDGEFOX_TEST_URL ?? "http://localhost:3035";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
await mkdir("artifacts/ui", { recursive: true });
const checks: string[] = [];
try {
  await page.goto(base);
  await page
    .getByRole("heading", { name: "Chrome extensions. Firefox freedom." })
    .waitFor();
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.theme === "daylight" &&
      !!document.documentElement.dataset.motion,
  );
  await page.evaluate(() => document.fonts.ready);
  // Pause before captures so screenshots never mutate pre-hydration inputs or sample entrances.
  await page
    .getByRole("button", { name: "Pause animations", exact: true })
    .click();
  await page.waitForFunction(
    () => document.documentElement.dataset.motion === "off",
  );
  await page.screenshot({
    path: "artifacts/ui/overview-desktop.png",
    fullPage: true,
  });
  for (const width of [1440, 1024, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
      `Overview overflow at ${width}`,
    );
    if (width === 390)
      await page.screenshot({
        path: "artifacts/ui/overview-mobile.png",
        fullPage: true,
      });
  }
  checks.push("Overview at 1440/1024/768/390/360 without horizontal overflow");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  const config = await (await page.request.get(`${base}/api/status`)).json();
  if (config.accessRequired || config.aiAccessRequired) {
    await page.getByLabel("Workspace access password").waitFor();
    checks.push("Protected Otari access has an available password field");
  }
  for (const [name, theme] of [
    ["After hours", "dusk"],
    ["Garden studio", "meadow"],
    ["Warm daylight", "daylight"],
  ]) {
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await page.waitForFunction(
      (t) => document.documentElement.dataset.theme === t,
      theme,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: `artifacts/ui/settings-${theme}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: /After hours/ }).click();
  await page.keyboard.press("Escape");
  await page.reload();
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.theme === "dusk" &&
      document.documentElement.dataset.motion === "off",
  );
  await page
    .getByRole("button", { name: "Change palette", exact: true })
    .click();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "meadow",
  );
  await page
    .getByRole("button", { name: "Change palette", exact: true })
    .click();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "daylight",
  );
  checks.push(
    "Three functional palettes, quick cycling, native settings dialog, and saved preferences",
  );
  const transformBefore = await page
    .locator(".chrome-card")
    .evaluate((el) => getComputedStyle(el).transform);
  await page.waitForTimeout(250);
  assert.equal(
    await page
      .locator(".chrome-card")
      .evaluate((el) => getComputedStyle(el).transform),
    transformBefore,
  );
  await page
    .getByRole("button", { name: "Enable animations", exact: true })
    .click();
  await page.waitForFunction(
    () => document.documentElement.dataset.motion === "on",
  );
  await page.waitForTimeout(250);
  const moving = await page
    .locator(".chrome-card")
    .evaluate((el) => getComputedStyle(el).transform);
  await page.waitForTimeout(300);
  assert.notEqual(
    await page
      .locator(".chrome-card")
      .evaluate((el) => getComputedStyle(el).transform),
    moving,
  );
  await page
    .getByRole("button", { name: "Pause animations", exact: true })
    .click();
  await page.waitForFunction(
    () => document.documentElement.dataset.motion === "off",
  );
  const reducedPage = await context.newPage();
  reducedPage.on("pageerror", (e) => errors.push(e.message));
  reducedPage.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await reducedPage.emulateMedia({ reducedMotion: "reduce" });
  await reducedPage.goto(base);
  await reducedPage.waitForFunction(
    () => document.documentElement.dataset.motion === "off",
  );
  await reducedPage
    .getByRole("button", { name: "Enable animations", exact: true })
    .click();
  await reducedPage.waitForFunction(
    () => document.documentElement.dataset.motion === "off",
  );
  const reducedBefore = await reducedPage
    .locator(".chrome-card")
    .evaluate((el) => getComputedStyle(el).transform);
  await reducedPage.waitForTimeout(250);
  assert.equal(
    await reducedPage
      .locator(".chrome-card")
      .evaluate((el) => getComputedStyle(el).transform),
    reducedBefore,
  );
  await reducedPage.close();
  checks.push(
    "Decorative Framer Motion runs when enabled, stops when paused, and honors reduced motion",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Try an example", exact: true })
    .click();
  await page.getByRole("heading", { name: "Tab Pocket" }).waitFor();
  await page
    .getByRole("heading", {
      name: "Background service worker needs a Firefox script",
    })
    .waitFor();
  await page.getByRole("tab", { name: /API compatibility/ }).click();
  await page.getByText("tabs.query", { exact: true }).waitFor();
  await page.getByRole("tab", { name: /Permissions/ }).click();
  await page.getByText("activeTab", { exact: true }).waitFor();
  await page.getByRole("tab", { name: /Findings/ }).click();
  await page.screenshot({
    path: "artifacts/ui/compatibility.png",
    fullPage: true,
  });
  checks.push(
    "Demo import, manifest findings, Mozilla API members and permissions",
  );
  await page
    .getByRole("button", { name: "Generate migration", exact: true })
    .click();
  await page.getByText("Proposals ready for review", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Review & export", exact: true })
    .waitFor();
  const proposal = page.getByLabel("Firefox source changes");
  assert.match((await proposal.textContent()) ?? "", /"scripts"/);
  assert.doesNotMatch((await proposal.textContent()) ?? "", /service_worker/);
  assert.match(
    (await page.getByLabel("Original Chrome source").textContent()) ?? "",
    /service_worker/,
  );
  await page.screenshot({ path: "artifacts/ui/workspace.png", fullPage: true });
  checks.push("Streamed local migration with real source diff and activity");
  await page.getByLabel("Search source files").fill("background");
  assert.equal(await page.locator(".file-tree > button").count(), 1);
  await page.locator(".file-tree > button").click();
  assert.match(
    (await page.getByLabel("Original Chrome source").textContent()) ?? "",
    /chrome/,
  );
  await page.getByLabel("Search source files").fill("no-such-file");
  await page.getByText("No files found.", { exact: true }).waitFor();
  await page.getByLabel("Search source files").fill("");
  await page
    .locator(".file-tree > button")
    .filter({ hasText: "manifest.json" })
    .click();
  await page.getByRole("button", { name: "Unified", exact: true }).click();
  assert.match(
    (await page.getByLabel("Unified source diff").textContent()) ?? "",
    /service_worker/,
  );
  assert.match(
    (await page.getByLabel("Unified source diff").textContent()) ?? "",
    /"scripts"/,
  );
  assert.equal(
    (await page.locator(".unified-diff .line-added").count()) > 0,
    true,
  );
  assert.equal(
    (await page.locator(".unified-diff .line-removed").count()) > 0,
    true,
  );
  await page.getByRole("button", { name: "Focus editor", exact: true }).click();
  assert.equal(await page.locator(".file-tree").isVisible(), false);
  assert.equal(await page.locator(".activity-panel").isVisible(), false);
  await page.screenshot({
    path: "artifacts/ui/editor-focus.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Exit editor focus", exact: true })
    .click();
  assert.equal(await page.locator(".file-tree").isVisible(), true);
  await page.getByRole("button", { name: "Split", exact: true }).click();
  checks.push(
    "Source search, empty results, file selection, unified additions/removals, and editor focus",
  );
  for (const width of [1440, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
      `Workspace overflow at ${width}`,
    );
  }
  checks.push("Workspace responsive at desktop/tablet/mobile");
  await page.screenshot({
    path: "artifacts/ui/workspace-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Review & export", exact: true })
    .click();
  await page.getByRole("heading", { name: "Validation results" }).waitFor();
  await page.getByRole("heading", { name: /Firefox runtime/ }).waitFor();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("button", { name: "Download Firefox ZIP", exact: true })
      .click(),
  ]);
  assert.equal(download.suggestedFilename(), "Tab-Pocket-firefox.zip");
  await download.saveAs("artifacts/ui/Tab-Pocket-firefox.zip");
  await page.screenshot({
    path: "artifacts/ui/export-desktop.png",
    fullPage: true,
  });
  for (const width of [1024, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
      `Export overflow at ${width}`,
    );
    if (width === 390)
      await page.screenshot({
        path: "artifacts/ui/export-mobile.png",
        fullPage: true,
      });
  }
  checks.push(
    "Candidate ZIP downloads and runtime test remains explicitly open",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "All migrations", exact: true })
    .click();
  await page.getByRole("button", { name: /Tab Pocket.*Candidate/ }).waitFor();
  await page.getByLabel("Search migration history").fill("missing-extension");
  await page.getByRole("heading", { name: "No matching migrations" }).waitFor();
  await page.getByLabel("Search migration history").fill("");
  await page.getByRole("button", { name: /Tab Pocket.*Candidate/ }).click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").isVisible(), false);
  checks.push("Actual local history, search, and accessible modal dismissal");
  await page
    .getByLabel("Choose extension source ZIP")
    .setInputFiles("public/examples/tab-pocket-chrome.zip");
  await page.getByRole("heading", { name: "Tab Pocket" }).waitFor();
  checks.push("ZIP upload via the actual import endpoint");
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/ui/checks.json",
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        base,
        checks,
        errors,
        liveOtariCalls: 0,
      },
      null,
      2,
    ),
  );
  console.log(checks.map((c) => `PASS ${c}`).join("\n"));
} finally {
  await browser.close();
}
