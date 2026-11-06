# BridgeFox

**Chrome extensions. Firefox freedom.**

A compatibility studio that helps port Chrome extension **source** into a reviewable Firefox add-on candidate. Import a ZIP or a small public GitHub repository, inspect compatibility findings, generate changes, review source side by side, and export a ZIP for temporary Firefox testing.

## Run locally

Requires Node.js 22.22.2 or newer.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open **http://localhost:3035**. Choose **Try an example** to migrate Tab Pocket with local rules. No AI account is required for this path.

The existing `.env.local` in this workspace is private. Do not overwrite it when it already contains your key.

## What works

- Bounded ZIP extraction with traversal, symlink, duplicate-entry, and size checks; binary assets and license files preserved.
- Public GitHub branch import through a fixed GitHub download host, with the same archive limits.
- Manifest V2/V3 detection, missing-resource checks, JavaScript parsing, and individual API-member checks using a committed Mozilla browser compatibility data snapshot.
- Conservative MV3 `background.service_worker` → `background.scripts` proposals and stable Firefox test identities. Compatible `chrome.*` calls are preserved.
- Syntax-highlighted source review with split/unified diffs, file search and editor focus, permission-preserving patch validation, local report history, validation results, and downloadable Firefox candidates.
- A responsive cream/coral/lavender studio, two alternative palettes, and Framer Motion interactions with persistent motion controls and device reduced-motion support.
- Server-side Otari integration: documentation fetch, a compatibility analyst and migration engineer, optional blocking gateway guardrails, authored sandbox validation, reported usage and fallback headers, and a per-job spending threshold.

See [docs/DESIGN.md](docs/DESIGN.md) for the visual system and interaction details.

## Otari setup

See [docs/OTARI.md](docs/OTARI.md). A genuine two-model migration of Tab Pocket completed on November 6, 2026, with Qwen3 Instruct analysis, Qwen3-Coder review, and Otari Python validation. The job cost **$0.010456**, and its exported ZIP passed Firefox save/persist/reopen checks. The models accepted the existing local manifest conversion without adding unnecessary code edits. [Gateway evidence](docs/evidence/otari-migration-2026-11-06.json) and [Firefox evidence](docs/evidence/firefox-otari-2026-11-06.json) retain request IDs and the tested ZIP hash.

Web fetch is disabled for this hosted workspace. Routing fallback, gateway guardrails, and a gateway-enforced key ceiling remain unverified. Local rules work independently; transport-mocked tests are separate from the live evidence.

## Verify

```bash
npm test
npm run typecheck
npm run build
npm run demo:zip
npm run lint:addon
# With the app running:
npm run check:ui
# Optional, with Firefox and geckodriver available:
npm run check:firefox
```

`npm run demo:zip` produces the original Chrome ZIP under `public/examples`, a migrated fixture under `fixtures/tab-pocket`, and a Firefox ZIP plus report under ignored `artifacts/`.

The Firefox runtime check uses Python 3’s standard library and Mozilla geckodriver. Set `BRIDGEFOX_FIREFOX_BINARY` and `BRIDGEFOX_GECKODRIVER` if they are not on your PATH. It installs the exported fixture in a temporary profile, grants Firefox’s native `activeTab` permission as a toolbar activation would, and checks saving, persistence, and reopening a real tab. It never touches your personal Firefox profile. A participant’s manual toolbar demonstration remains necessary for the hackathon video.

For a deliberately paid verification, start the configured app and run `npm run check:otari -- --run`. Results are retained under `artifacts/otari/`. To test that exact output, set `BRIDGEFOX_ADDON_ZIP` to its ZIP, `BRIDGEFOX_MIGRATION_REPORT` to its `migration.json`, and optionally `BRIDGEFOX_FIREFOX_ARTIFACT` to a separate output directory before running the Firefox check. Inspect retained costs before repeating a failed live run.

## Install a candidate

Extract the downloaded ZIP. In desktop Firefox, visit `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select the extracted `manifest.json`. Test each feature. Temporary add-ons disappear on browser restart. Permanent distribution requires the usual Mozilla signing and review process.

## Scope

BridgeFox is a migration tool, not a Chrome runtime inside Firefox. Static checks cannot prove behavioral compatibility. The score reflects the checked rules, not a probability of success. Dynamic API aliases, parameter semantics, third-party libraries, older Firefox versions, bundled/minified code, and complex service-worker lifecycles require manual inspection. Unknown API members are marked for review; known unsupported features block candidate export. AI source proposals require human review.

The MVP does not build TypeScript sources, run uploaded code on the server, install add-ons automatically, import Chrome Web Store packages, translate native binaries, or publish to Mozilla Add-ons. GitHub import expects one extension root and an archive of at most 8 MB. Large source repositories should be built and uploaded as extension ZIPs. Missing Firefox data-collection declarations are marked for author review; the tool never assumes an imported extension collects no data.

For public deployment, set a workspace access password, configure gateway budgets, and deploy behind appropriate HTTPS/access controls. The development and production commands bind to loopback by default. This is a single-workspace MVP, without hosted account management or durable per-user job storage.

See [docs/SUBMISSION.md](docs/SUBMISSION.md) for the hackathon checklist and a participant-recorded demo outline.

## License

MIT. Mozilla browser compatibility data is CC0-1.0; the snapshot records its version and source. Font and icon packages retain their upstream licenses.
