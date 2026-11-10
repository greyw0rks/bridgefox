# Otari feedback — BridgeFox

Prepared from the recorded BridgeFox integration work. The participant requested drafted answers on November 10, 2026.

## When were you most tempted to bypass Otari and call a provider directly?

During initial setup, a completion request returned HTTP 402 before I could get the migration workflow working. I wanted a clearer way to tell whether the issue was billing, the selected model, or workspace configuration. Calling a provider directly felt like a quicker way to isolate the problem. After funding and configuring two available models, Otari's central usage reporting became useful: I could inspect the analyst and engineer separately and retain the actual job cost. I would improve the setup diagnostics rather than abandon the gateway.

## What did you build yourself that Otari should have done for you?

I built polling for delayed usage, handling for missing cost information, and a local spending threshold that stops subsequent calls when the budget is reached. A clearer gateway contract for final usage and enforceable per-job budgets would simplify that code. I also supplied bundled Mozilla references because web fetch was disabled in this workspace; exposing tool availability before starting a job would make that easier to explain to users. BridgeFox still needs its own extension-specific patch and permission checks, because generic gateway validation cannot replace domain validation.

## Without the requirement, would you continue using Otari?

Yes, for workflows that benefit from multiple models and one place to inspect usage. BridgeFox used one Qwen model for compatibility analysis and another for engineering review, then retained the sandbox result and cost. That is a useful foundation for a reviewable engineering workflow. My continued use would depend on clearer workspace setup, predictable tool availability, and well-documented budget behavior. I would keep local migration available so the core product remains useful without an AI account.

## Evidence and limits

The genuine Tab Pocket migration on November 6 used two models, passed Otari Python validation, cost $0.010456, and produced the exact ZIP subsequently checked in Firefox. See `docs/evidence/otari-migration-2026-11-06.json` and `docs/evidence/firefox-otari-2026-11-06.json`.

The Firefox large-source interruption also showed why usage recovery matters: gateway calls had already been processed while the browser lost the response. BridgeFox corrected its own stream acknowledgement, keep-alives, and repeated scanning. That was an application fix; it is not presented as an Otari gateway defect. Routing fallback, gateway guardrails, and gateway-enforced key ceilings remain unverified. No Otari issue or PR was filed as part of this feedback.
