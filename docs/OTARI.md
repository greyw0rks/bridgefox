# Otari integration

The gateway client and migration workflow live in `src/lib/otari.ts` and `src/lib/migrate.ts`. No provider API is called directly.

## Configure

In `.env.local`:

```dotenv
OTARI_BASE_URL=https://eu.api.otari.ai/api/v1
OTARI_API_KEY=YOUR_PRIVATE_KEY
OTARI_ANALYST_MODEL=alibaba/qwen-3.5-35b-a3b
OTARI_ENGINEER_MODEL=CHOOSE_ANOTHER_AVAILABLE_OPEN_WEIGHT_MODEL
OTARI_GUARDRAIL_PROFILE=
BRIDGEFOX_JOB_BUDGET_USD=0.50
BRIDGEFOX_ACCESS_TOKEN=
```

Fill placeholders privately, then restart Next.js. The analyst and engineer identifiers must differ. Verify each model’s availability and open-weight license in the hosted catalogue; a model identifier alone does not establish license eligibility. Existing Otari routing policies may be used in place of model IDs. Ensure that their underlying models are distinct if claiming the rubric’s two-model points.

Attach an actual spending ceiling to the Otari API key. Configure role-specific routing/fallback policies in the dashboard if demonstrating routing. Set `OTARI_GUARDRAIL_PROFILE` only to a profile that exists on your deployment; requests use `mode: block` and `on_unavailable: block`.

The workspace settings panel shows configuration presence, not a verified connection. Tool availability is inspected during a user-triggered AI migration. Once configured, choose **Otari · two-model workflow** in the compatibility screen.

## Actual request sequence

1. `GET /tools`: discover usable gateway tools.
2. `POST /fetch`: fetch Mozilla’s background-manifest documentation, if available. Fetched text is supplied to the analyst as untrusted reference data.
3. `POST /chat/completions`: the analyst produces structured risks and a plan, without code edits.
4. `POST /chat/completions`: the engineer proposes exact replacements for existing text files.
5. Local checks reject invalid, stale, unsafe, permission-changing, feature-deleting, or incompatible patch batches atomically.
6. `POST /code/execute`, if available: run an authored Python manifest/permission validator in Otari’s sandbox. Uploaded JavaScript is never executed. The sandbox tests manifest invariants, not Firefox behavior.
7. Local static validation runs and the UI exposes actual gateway response metadata.

The client uses `Otari-Key`, follows no redirects, sends no automatic retries, and reads `Otari-Request-ID`, `Otari-Model`, `Otari-Provider`, `Otari-Fallback`, `Otari-Attempt-Count`, and `Otari-Guardrails`. These are reported only when received. A gateway routing policy controls actual fallback behavior; the application does not invent a fallback after a timeout.

## Costs and failures

Inline `usage.cost_usd` is used when provided. Otherwise a returned request ID is looked up through `GET /usage/requests/{id}`. Because settlement can be delayed, a 404 is polled up to four times with short delays; the paid operation is never repeated. If cost remains unknown, further paid calls stop; an unknown cost is never treated as free. The local job threshold prevents subsequent calls after reaching the threshold and cannot prevent the current request from exceeding it. Gateway key ceilings remain necessary. Other clients and concurrent jobs are outside this local threshold.

On HTTP 402, inspect account funds, key/workspace budgets, and model/tool pricing or allowance. This workspace’s one requested `Hello` completion returned 402 on November 5, 2026. The response body was not retained, so the specific cause is unconfirmed. No automatic retry or successful assistant reply was recorded. Further live paid verification remains pending.

Failed or unavailable steps appear as failed/skipped. Accepted local changes remain reviewable when the AI workflow stops. A candidate exported after an interrupted AI workflow must be treated as a local/static candidate, with the failed AI steps visible in its report.

## Rubric evidence

| Capability | Implementation | Evidence needed before claiming points |
| --- | --- | --- |
| Open-weight models | Role-specific model configuration | Successful requests using eligible models and their license references |
| Multiple models | Separate analyst and engineer calls | Two distinct resolved models used for the separate roles |
| Routing/fallback | Policy names + returned serving/attempt/fallback headers | A genuine routed request demonstrating the claimed routing behavior |
| Web fetch | Direct Otari fetch supplies documentation to the analyst | Successful fetch and its downstream use |
| Code execution | Direct Otari sandbox manifest validator | Successful sandbox response and checks demonstrated |
| Budgets | Job threshold + gateway key ceiling | Real gateway budget configuration and a demonstrated enforced limit |
| Guardrails | Optional fail-closed request checks | A genuine returned gateway verdict or blocked request |

Local patch checks do not independently prove Otari guardrail use. Mocked gateway tests do not earn hackathon points. MCP and per-user budgets are not implemented in this MVP. A maximum rubric score has not been established.

## API references

Implementation checked against Mozilla AI Otari main commit `3cca8d6759e3b91c1f6817a8d53d4e3a80e0866e` (November 4, 2026): [API reference](https://github.com/mozilla-ai/otari/blob/3cca8d6759e3b91c1f6817a8d53d4e3a80e0866e/docs/api-reference.md), [tools](https://github.com/mozilla-ai/otari/blob/3cca8d6759e3b91c1f6817a8d53d4e3a80e0866e/docs/tools.md), [routing](https://github.com/mozilla-ai/otari/blob/3cca8d6759e3b91c1f6817a8d53d4e3a80e0866e/docs/routing.md), and [guardrails](https://github.com/mozilla-ai/otari/blob/3cca8d6759e3b91c1f6817a8d53d4e3a80e0866e/docs/guardrails.md). Hosted deployments may differ.
