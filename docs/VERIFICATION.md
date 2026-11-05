# Verification — November 5, 2026

The local migration workflow is verified. A successful hosted Otari migration remains pending.

| Check | Result |
| --- | --- |
| Pipeline tests | 24 passing: source migration/export, API checks, malformed inputs, archive safety, manifest/permission invariants, mocked GitHub import, mocked Otari roles/tools/costs/failures, and delayed usage settlement |
| TypeScript | Passed standalone check and production build type checking |
| Production build | Passed with Next.js 16.4.5 |
| Add-on lint | Tab Pocket: zero errors, notices, or warnings with web-ext 10.8.0 |
| Browser UI | Seven check groups passed against the production app; desktop/tablet/mobile widths 1440, 1024, 768, 390, and 360 checked as applicable |
| Firefox runtime | Exported ZIP installed in Firefox 141.0; a real web tab saved, persisted across popup reload, and reopened |
| Hosted Otari | One requested Hello completion returned HTTP 402. No successful completion, live tools, or migration evidence |

The pipeline/GitHub/Otari network checks use mock transports and make no paid requests. The UI check exercises actual local HTTP endpoints and downloads the generated ZIP.

The Firefox runtime test uses Mozilla geckodriver in a disposable profile. It invokes Firefox’s native `activeTab` grant to simulate toolbar activation, then operates the actual extension popup and storage APIs. It does not add manifest permissions or use the participant’s own browser profile. This proves the included fixture’s tested behavior, not arbitrary extension portability. The participant should still click the toolbar action and demonstrate the extension in their own recording.

Structured evidence: [UI](evidence/ui-checks.json), [Firefox](evidence/firefox-checks.json). Local screenshots, pipeline TAP output, and generated packages are under ignored `artifacts/`.

Browser tooling downloaded for this machine is stored outside the project under the Playwright cache and `/tmp/bridgefox-browser-deps`. The system’s missing Firefox libraries were extracted there without changing system packages or editor settings. The geckodriver archive was checked against its GitHub SHA-256 digest. Reproduction on another machine uses its own Firefox/geckodriver and any required browser libraries.

Remaining integration work: resolve Otari funds/budget/pricing access, choose a second distinct available open-weight model, configure real routing/guardrail/budget settings, and collect actual successful gateway evidence. Public repository publication, participant recordings, written feedback, and hackathon submission are also pending.
