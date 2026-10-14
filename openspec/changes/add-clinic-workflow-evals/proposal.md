# Proposal

## Why

The clinic workflow (`assistant/conversation-flow.json`) ships 19 nodes and 35 edges, the majority of which are LLM-conditioned routing decisions. The eval harness built in `add-workflow-eval-boilerplate` currently runs a single boilerplate scenario (`Routing: Handle Request`) that only exercises the intent-to-FAQ edge. There is no automated regression coverage for the remaining routing edges, the appointment create/list/cancel lifecycle, or the adversarial edge cases the challenge spec calls out (out-of-hours rejection, FAQ escalation, conflict + alternative acceptance, verification-gate corrections). Without these scenarios, a workflow change can silently break a routing path and ship to production undetected.

## What Changes

- Add 23 typed `TestScenario` objects in a new `workflow/eval/clinic-scenarios.ts` module, grouped into three test suites:
  - `clinic-routing` — 16 scenarios, one per high-value LLM-condition edge (intent→4 targets, appt_menu→4 targets, verify_create→3 targets, verify_cancel→3 targets, anything_else→2 targets). Each scenario carries a dual-criterion rubric: (a) the conversation reached the expected target node, and (b) the conversation did not diverge to the sibling node that would indicate a mis-route.
  - `clinic-appointment-lifecycle` — 1 end-to-end scenario that walks create→verify→list→cancel→list in a single conversation, asserting the booking appears after creation and disappears after cancellation, and that the verification gate fires before both destructive actions.
  - `clinic-edge-cases` — 6 adversarial scenarios: out-of-hours slot rejection, FAQ out-of-scope escalation, conflict + accept-suggested-alternative, mid-collection abandon, explicit human-request, and "anything else?" loop twice.
- Extend the `TestScenario` type with an optional `target_edge_ids?: string[]` field so scenarios can declare which `conversation_flow.json` edge IDs they cover, enabling a static coverage audit.
- Extend the CLI (`workflow/eval/run-eval.ts`) to accept `--suite <name>` and `--scenario <name>` flags so the user can run a subset of scenarios, iterate over all selected scenarios, and print a summary matrix of per-criterion results at the end.
- Add a coverage-guardrail unit test in `workflow/eval/eval.test.ts` that walks `conversation-flow.json` and fails if any LLM-conditioned edge is not referenced by at least one scenario's `target_edge_ids`.
- Add a scenario-shape validation unit test that asserts every clinic scenario satisfies the Telnyx `TestCreateParams` schema (non-empty name, instructions, rubric; channel is a valid enum value).
- Document the clinic eval suites and CLI usage in `README.md`.

## Capabilities

### New Capabilities

None — all new requirements extend the existing `workflow-eval` capability.

### Modified Capabilities

- `workflow-eval`: Extends the existing eval capability with a curated scenario library covering the clinic workflow's high-value routing edges, the appointment create/list/cancel lifecycle, and adversarial edge cases. Adds edge-target tagging for coverage auditing, scenario-subset selection via CLI flags, and an automated coverage guardrail that detects workflow drift (new LLM-conditioned edges added without a corresponding eval scenario).

## Impact

- **New code**: `workflow/eval/clinic-scenarios.ts` (one new file exporting 23 scenarios).
- **Modified code**: `workflow/eval/types.ts` (add `target_edge_ids` field), `workflow/eval/run-eval.ts` (CLI flag parsing + multi-scenario iteration + summary matrix), `workflow/eval/eval.test.ts` (coverage guardrail + scenario shape tests), `README.md` (clinic eval documentation).
- **Dependencies**: None — reuses the existing `telnyx` SDK and the eval harness built by `add-workflow-eval-boilerplate`.
- **APIs**: Calls the same Telnyx Assistant Tests API endpoints as the boilerplate (`POST /ai/assistants/tests`, `POST /ai/assistants/tests/{test_id}/runs`, `GET .../runs/{run_id}`). No new API surfaces.
- **Runtime behavior**: `npm run eval` now runs all scenarios by default (boilerplate + 23 clinic scenarios). `npm run eval -- --suite clinic-routing` narrows to one suite. Each scenario triggers a real conversation against the deployed assistant via the Tests API; full suite runtime is ~6 minutes at ~15s per scenario.
- **No breaking changes** — the existing `handleRequestScenario` boilerplate and `npm run eval` default behavior are preserved; the new scenarios are additive.
