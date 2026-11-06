# Verification — November 6, 2026

The local migration workflow and one genuine hosted Otari migration are verified. The hosted models reviewed Tab Pocket's local manifest conversion and proposed no additional code edits. The exact exported candidate passed Firefox runtime checks.

| Check | Result |
| --- | --- |
| Pipeline tests | 25 passing: source migration/export, API checks, malformed inputs, archive safety, manifest/permission invariants, mocked GitHub import, mocked Otari roles/tools/costs/failures, delayed usage settlement, and unusable billed model output |
| TypeScript | Passed standalone check and production build type checking |
| Production build | Passed with Next.js 16.4.5 |
| Add-on lint | Tab Pocket: zero errors, notices, or warnings with web-ext 10.8.0 |
| Browser UI | Seven check groups passed against the production app; desktop/tablet/mobile widths 1440, 1024, 768, 390, and 360 checked as applicable |
| Firefox runtime | Exported ZIP installed in Firefox 141.0; a real web tab saved, persisted across popup reload, and reopened |
| Hosted Otari | Two distinct Qwen models and the Python sandbox completed; $0.010456 known job cost; candidate exported through actual Next.js endpoints |
| Hosted candidate lint | Exact exported ZIP: zero errors, notices, or warnings with web-ext 10.8.0 |
| Hosted candidate Firefox | Exact ZIP installed in Firefox 141.0; real tab saved, persisted across popup reload, and reopened |

The pipeline/GitHub/Otari network checks use mock transports and make no paid requests. The UI check exercises actual local HTTP endpoints and downloads the generated ZIP.

The Firefox runtime test uses Mozilla geckodriver in a disposable profile. It invokes Firefox’s native `activeTab` grant to simulate toolbar activation, then operates the actual extension popup and storage APIs. It does not add manifest permissions or use the participant’s own browser profile. This proves the included fixture’s tested behavior, not arbitrary extension portability. The participant should still click the toolbar action and demonstrate the extension in their own recording.

Structured evidence: [UI](evidence/ui-checks.json), [local Firefox](evidence/firefox-checks.json), [hosted gateway](evidence/otari-migration-2026-11-06.json), [hosted candidate Firefox](evidence/firefox-otari-2026-11-06.json), and [catalogue/licenses/setup failures](evidence/otari-connection-2026-11-06.json). The retained [hosted candidate ZIP](evidence/tab-pocket-otari-firefox.zip) has SHA-256 `3e41fce68d0da0b726d3f7eccfc00988be3929f6219b8b60f452faa6f74130d0`, matching the runtime evidence. Streamed events, full local reports, screenshots, and unpacked candidates are under ignored `artifacts/`.

Browser tooling downloaded for this machine is stored outside the project under the Playwright cache and `/tmp/bridgefox-browser-deps`. The system’s missing Firefox libraries were extracted there without changing system packages or editor settings. The geckodriver archive was checked against its GitHub SHA-256 digest. Reproduction on another machine uses its own Firefox/geckodriver and any required browser libraries.

Remaining integration work: enable web fetch for the workspace if needed, and demonstrate real routing/fallback, gateway guardrails, and gateway-enforced key ceilings before claiming those capabilities. The successful job stayed below the $0.50 local threshold; that does not prove an enforced gateway limit. Earlier failed runs remain in the evidence, including the engineer refusal's null cost. Public repository publication, participant recordings, written feedback, and hackathon submission are also pending.
