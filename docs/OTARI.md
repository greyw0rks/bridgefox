# Otari integration

The gateway client and migration workflow live in `src/lib/otari.ts` and `src/lib/migrate.ts`. No provider API is called directly.

## Configure

In `.env.local`:

```dotenv
OTARI_BASE_URL=https://eu.api.otari.ai/api/v1
OTARI_API_KEY=YOUR_PRIVATE_KEY
OTARI_ANALYST_MODEL=alibaba/qwen3-235b-a22b-instruct-2507
OTARI_ENGINEER_MODEL=alibaba/qwen3-coder-30b-a3b-instruct
OTARI_GUARDRAIL_PROFILE=
BRIDGEFOX_JOB_BUDGET_USD=0.50
BRIDGEFOX_ACCESS_TOKEN=
```

Fill placeholders privately, then restart Next.js. The analyst and engineer identifiers must differ. Verify each model’s availability and open-weight license in the hosted catalogue; a model identifier alone does not establish license eligibility. Existing Otari routing policies may be used in place of model IDs. Ensure that their underlying models are distinct if claiming the rubric’s two-model points.

Attach an actual spending ceiling to the Otari API key. Configure role-specific routing/fallback policies in the dashboard if demonstrating routing. Set `OTARI_GUARDRAIL_PROFILE` only to a profile that exists on your deployment; requests use `mode: block` and `on_unavailable: block`.

The workspace settings panel shows configuration presence, not a verified connection. Tool availability is inspected during a user-triggered AI migration. Once configured, choose **Otari · two-model workflow** in the compatibility screen.

For a read-only connectivity check, run `npm run check:gateway-connection`. It calls `/tools` and records authentication and tool availability under `artifacts/connection/`, without sending paid model or tool operations. A browser-to-app interruption preserves the imported source and clears the busy state; inspect gateway usage before starting another AI job. Large streamed results are assembled from new chunks without repeatedly copying and rescanning the unfinished result.

For a deliberate paid verification with the app running, use `npm run check:otari -- --run`. It sends one migration through the actual local API, saves streamed activities and the result, and exports the candidate under `artifacts/otari/`. It never retries a paid operation. Check the retained usage before running it again after a failure.

The current selected weights are Apache 2.0: [Qwen3-235B-A22B-Instruct-2507](https://huggingface.co/Qwen/Qwen3-235B-A22B-Instruct-2507) and [Qwen3-Coder-30B-A3B-Instruct](https://huggingface.co/Qwen/Qwen3-Coder-30B-A3B-Instruct). The catalogue and pinned license references are retained in [connection evidence](evidence/otari-connection-2026-11-06.json).

## Actual request sequence

1. `GET /tools`: discover usable gateway tools.
2. `POST /fetch`: fetch Mozilla’s background-manifest documentation, if available. Fetched text is supplied to the analyst as untrusted reference data.
3. `POST /chat/completions`: the analyst produces structured risks and a plan, without code edits.
4. `POST /chat/completions`: the engineer proposes exact replacements for existing text files.
5. Local checks reject invalid, stale, unsafe, permission-changing, feature-deleting, or incompatible patch batches atomically.
6. `POST /code/execute`, if available: run an authored Python manifest/permission validator in Otari’s sandbox. Uploaded JavaScript is never executed. The sandbox tests manifest invariants, not Firefox behavior.
7. Local static validation runs and the UI exposes actual gateway response metadata.

Large imports retain the same bounded gateway workload: up to 90,000 source characters, supplied as whole files. The manifest and declared entrypoints take priority, followed by files with static findings. Binary assets and other omitted source remain in the archive. The report states how many source files were supplied, marks omitted source for manual review, and rejects AI patches outside the supplied files. A partial AI review is returned as `review`, even when its model and sandbox steps complete. Large manifests that cannot fit stop the AI path before any gateway request; local scan and export remain available.

The client uses `Otari-Key`, follows no redirects, sends no automatic retries, and reads `Otari-Request-ID`, `Otari-Model`, `Otari-Provider`, `Otari-Fallback`, `Otari-Attempt-Count`, and `Otari-Guardrails`. These are reported only when received. A gateway routing policy controls actual fallback behavior; the application does not invent a fallback after a timeout.

The analyst requests JSON response mode. The hosted coder rejected this parameter despite catalogue support, so the engineer relies on the JSON-only prompt and strict local schema. Invalid or empty proposals mark the role failed and retain its actual billed cost. The activity metadata includes the returned finish reason and token counts without storing model reasoning.

## Costs and failures

Inline `usage.cost_usd` is used when provided. Otherwise a returned request ID is looked up through `GET /usage/requests/{id}`. Because settlement can be delayed, a 404 is polled up to four times with short delays; the paid operation is never repeated. If cost remains unknown, further paid calls stop; an unknown cost is never treated as free. The local job threshold prevents subsequent calls after reaching the threshold and cannot prevent the current request from exceeding it. Gateway key ceilings remain necessary. Other clients and concurrent jobs are outside this local threshold.

On HTTP 402, inspect account funds, key/workspace budgets, and model/tool pricing or allowance. The first requested `Hello` completion returned 402 on November 5, 2026; its specific cause remains unconfirmed. After the user funded the account, the November 6 two-model workflow and Python sandbox completed for **$0.010456**. The earlier funded analyst attempt returned no answer and reached its 3,000-token cap ($0.003171). A second run's analyst completed ($0.000192), but its engineer was rejected with `unsupported_parameter`, zero token usage, and a null cost. Those failures and the uncertainty are retained in the connection evidence; they are not counted as successful migrations.

The successful analyst resolved to `Qwen/Qwen3-235B-A22B-Instruct-2507` on DeepInfra. The engineer resolved to `qwen.qwen3-coder-30b-a3b-v1:0` on Bedrock. Both reported one attempt and no fallback. The sandbox returned exit code 0 and `PASS: manifest version, background entrypoints, and permission preservation`. It cost $0.01; the two model requests cost $0.000178 and $0.000278. Web fetch was skipped because the workspace reported `workspace_disabled`. See [live evidence](evidence/otari-migration-2026-11-06.json).

Failed or unavailable steps appear as failed/skipped. Accepted local changes remain reviewable when the AI workflow stops. A candidate exported after an interrupted AI workflow must be treated as a local/static candidate, with the failed AI steps visible in its report.

## Rubric evidence

| Capability | Implementation | Evidence needed before claiming points |
| --- | --- | --- |
| Open-weight models | Role-specific model configuration | Demonstrated November 6 with two Qwen models; pinned Apache 2.0 weight references in connection evidence |
| Multiple models | Separate analyst and engineer calls | Demonstrated with distinct resolved Qwen3 Instruct and Qwen3-Coder models |
| Routing/fallback | Policy names + returned serving/attempt/fallback headers | A genuine routed request demonstrating the claimed routing behavior |
| Web fetch | Direct Otari fetch supplies documentation to the analyst when enabled | Pending: workspace reports web fetch disabled |
| Code execution | Direct Otari sandbox manifest validator | Demonstrated November 6: exit 0, background/manifest/permission assertions passed |
| Budgets | Job threshold + gateway key ceiling | Real gateway budget configuration and a demonstrated enforced limit |
| Guardrails | Optional fail-closed request checks | A genuine returned gateway verdict or blocked request |

Local patch checks do not independently prove Otari guardrail use. Mocked gateway tests do not earn hackathon points. MCP and per-user budgets are not implemented in this MVP. A maximum rubric score has not been established.

## API references

Implementation checked against Mozilla AI Otari main commit `3cca8d6759e3b91c1f6817a8d53d4e3a80e0866e` (November 4, 2026): [API reference](https://github.com/mozilla-ai/otari/blob/3cca8d6759e3b91c1f6817a8d53d4e3a80e0866e/docs/api-reference.md), [tools](https://github.com/mozilla-ai/otari/blob/3cca8d6759e3b91c1f6817a8d53d4e3a80e0866e/docs/tools.md), [routing](https://github.com/mozilla-ai/otari/blob/3cca8d6759e3b91c1f6817a8d53d4e3a80e0866e/docs/routing.md), and [guardrails](https://github.com/mozilla-ai/otari/blob/3cca8d6759e3b91c1f6817a8d53d4e3a80e0866e/docs/guardrails.md). Hosted deployments may differ.
