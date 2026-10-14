---
name: update-assistant-workflow
description: Deploy and re-eval the ACME Clinic assistant when assistant.config.json changes. Auto-use when the user edits, updates, or commits changes to workflow/assistant.config.json or assistant/conversation-flow.json — deploy the updated workflow to Telnyx Edge (assistant update via `npm run deploy:assistant`; auto-switch to full `npm run deploy` when edge/** files are also modified) and run only the clinic-scenario subset relevant to the change, not the entire 24-scenario eval matrix, to reduce test duration and cost. Trigger whenever the user mentions editing the assistant config, conversation flow, workflow nodes or edges, prompt or speak node text, model, or dynamic variables — even if they don't explicitly ask for "deploy" or "eval". Trigger phrases include "update the assistant", "change the workflow", "edit the conversation flow", "update assistant.config.json", "redeploy the assistant", "re-eval the workflow".
compatibility: telnyx-edge CLI authenticated; .env with TELNYX_API_KEY, ASSISTANT_ID, ASSISTANT_CACHE, ASSISTANT_DESTINATION.
metadata:
  author: acme-clinic
  version: "1.0"
---

Deploy the updated ACME Clinic assistant to Telnyx Edge and run a relevant subset of eval scenarios — not the entire 24-scenario matrix — to keep test duration and cost low. The subset selection is driven by what actually changed in the config: a localized prompt-node edit only needs the edge-level scenarios that touch it; a model swap or top-level metadata change runs the full matrix.

This skill is the guardrail between editing `workflow/assistant.config.json` and shipping a broken assistant to production. It never skips the offline coverage guardrail, never commits or logs secrets, and never auto-commits the changes.

**Input**: Either `workflow/assistant.config.json` or `assistant/conversation-flow.json` is modified (check via `git status --porcelain`), or the user explicitly asks to update/redeploy/re-eval the workflow. If neither file is modified and the user did not name this skill, do not auto-fire.

**Prompt authoring principles**

These principles govern every prompt edit or suggested fix — whether made proactively before a deploy or reactively after an eval failure (step 8). They prevent prompt drift, keep the workflow maintainable, and produce fixes that generalize beyond the one scenario that failed.

1. **Prefer the root instruction for workflow-wide rules.** If a rule applies to multiple nodes (e.g., "the caller's phone number is already known — never ask for it", "each node has one job — do not do the next node's work inline"), put it once in the top-level `instructions` field of `workflow/assistant.config.json`. Node-level `instructions` are `append`-mode — they combine with the root, so the rule applies everywhere without duplication. Drop down to a node-level instruction only when the rule is specific to that one node's job.

2. **Use composition, not copy-paste.** If a rule applies to a subset of nodes (not all), consider whether the dynamic-variable webhook can inject the relevant context once, or whether the rule belongs in the edge's `condition.prompt` (the routing criterion) rather than the node's `instructions`. Avoid pasting the same paragraph into 3+ nodes — when one of those nodes later needs different behavior, the duplicated text will drift and break silently.

3. **Fix the root cause, not the symptom.** Do not narrowly tune a prompt to pass one specific eval scenario. If multiple scenarios fail in a related way (e.g., the LLM executes the next step's logic inline across several controller nodes), that is one root cause — fix it once at the right level (usually the root instruction or a shared edge condition), not once per failing scenario. A fix that only passes the failing test without addressing the underlying behavior will regress on the next unseen input.

4. **Use negative cases sparingly.** "Do NOT do X" instructs the model to avoid one specific failure mode, but there can be many such modes — listing them all makes the prompt brittle and the model over-cautious. Prefer a positive framing of the node's single job ("Your only job here is Y; after Y, stop and let the workflow route."), and reserve "do NOT" for cases where the model demonstrably and repeatedly confuses two adjacent nodes (e.g., "do NOT call the booking tool on this node — booking happens on the next node").

5. **One job per node.** Each prompt node should have one clearly scoped job (classify intent, collect a field, verify a confirmation, execute a tool). If a node's instructions describe multiple jobs or conditionally perform the next node's work, that is the root cause — split the responsibility or push the action to the correct downstream node, then express the fix at the appropriate level per principles 1–2.

When in doubt about where a fix belongs, work top-down: ask whether the root instruction already covers it; if not, ask whether an edge condition is the right place; only then consider a node-level instruction.

**Steps**

1. **Verify preconditions**

   Run these before any deploy:
   ```bash
   telnyx-edge auth status
   test -f .env
   git status --porcelain
   ```
   Confirm `.env` has `TELNYX_API_KEY`, `ASSISTANT_ID`, `ASSISTANT_CACHE`, and `ASSISTANT_DESTINATION` set. Surface any missing value plainly and stop — do not attempt a deploy with incomplete credentials. `ASSISTANT_DESTINATION` is what the eval harness targets; the other three drive the deploy.

2. **Detect what changed**

   ```bash
   git diff --name-only
   git status --porcelain edge/
   ```
   - If `workflow/assistant.config.json` or `assistant/conversation-flow.json` is in the diff, proceed.
   - If only `edge/**` files changed (no assistant config), this skill is not the right tool — stop and tell the user to run the regular deploy workflow instead.
   - Capture `git status --porcelain edge/` for the deploy-mode decision in step 6.

3. **Analyze the diff**

   ```bash
   git diff workflow/assistant.config.json workflow/conversation-flow.json
   ```
   Parse the diff and identify:
   - **Changed node IDs** — keys `id`, `name`, `message` (speak nodes), `instructions` (prompt nodes), `shared_tool_ids`, `instructions_mode`.
   - **Changed edge IDs** — and for each, whether its `condition.type` is `llm`, `expression`, or `default`. Only LLM-conditioned edges feed routing evals.
   - **High-level field changes** — `model`, `dynamic_variables` defaults, `enabled_features`, `dynamic_variables_webhook_url` / `dynamic_variables_webhook_timeout_ms`, `mcp_servers`, `tool_ids`, `name`.
   - Count how many of the 19 nodes and 35 edges were touched — used to distinguish a localized change from a bulk rewrite.

4. **Sync the conversation-flow snapshot**

   The offline coverage guardrail reads `assistant/conversation-flow.json`, not `workflow/assistant.config.json`. Keep them in sync before running it:
   - Load `workflow/assistant.config.json`.
   - Extract the `conversation_flow` object.
   - Write `{"conversation_flow": <that object>}` (pretty-printed, 2-space indent) to `assistant/conversation-flow.json`.
   - If `workflow/assistant.config.json` was not changed but `assistant/conversation-flow.json` was (manual snapshot edit), skip this step — the snapshot is already the source.

   Running the guardrail against a stale snapshot would silently hide workflow drift.

5. **Run the offline coverage guardrail + scenario-shape tests**

   ```bash
   npx tsx workflow/eval/eval.test.ts
   ```
   This validates every clinic scenario's shape and audits that all 16 high-value LLM-conditioned edges in `assistant/conversation-flow.json` are covered by at least one scenario's `target_edge_ids`.

   **If it fails and names an uncovered edge ID**: a new LLM edge was added to the workflow without a matching scenario (workflow drift). Stop. The user must add a scenario to `workflow/eval/clinic-scenarios.ts` whose `target_edge_ids` includes the named edge, then re-run this step. Do not proceed to deploy or live eval until the guardrail passes.

   **If any scenario-shape test fails**: stop and fix the scenario definition before continuing.

6. **Pick and run the deploy**

   - If `git status --porcelain edge/` shows any modified edge file (from step 2), run the **full** edge + assistant deploy:
     ```bash
     npm run deploy
     ```
     This runs edge `npm install → typecheck → lint → test`, ships with `telnyx-edge ship`, polls `/health/liveness`, then redeploys the assistant (validates config, re-ensures MCP server `acme-clinic-mcp` + the 4 shared tools, replaces `PLACEHOLDER_*_TOOL_ID` strings in `shared_tool_ids`, updates the live assistant via `ASSISTANT_ID`).

   - Else (config-only change), run the assistant-only deploy:
     ```bash
     npm run deploy:assistant
     ```
     This is faster: it skips the edge `ship` and just updates the live assistant's config + tools + MCP server.

   Do not commit unexpectedly. Never log `TELNYX_API_KEY` or any secret. The hangup tool ID (`tool-c197145f-...`) baked into `n_hangup` is real and should stay — only the `PLACEHOLDER_*` strings inside `shared_tool_ids` arrays get replaced.

7. **Select the relevant eval scenario subset**

   Load the source of truth at runtime — do not rely on a static mapping table:
   - Read `workflow/eval/clinic-scenarios.ts` to get `allClinicScenarios` (23 clinic scenarios + the boilerplate `Routing: Handle Request`). Each scenario carries `name`, `test_suite`, `instructions`, `rubric`, `target_edge_ids` (optional), `max_duration_seconds` (optional).
   - Read `assistant/conversation-flow.json` to get the live node/edge graph.

   Then apply these rules in order:

   **a. High-level or bulk change → run the full matrix.**
   If the diff changed `model`, `dynamic_variables` defaults, `enabled_features`, top-level metadata, or touched more than ~half of the 19 nodes / 35 edges, run:
   ```bash
   npm run eval
   ```
   (No flags — runs all 24 scenarios. ~12 min. Maximum confidence since every LLM edge exercises the model.)

   **b. Localized change → build a targeted subset.**

   1. **Direct edge matches (deterministic).** For each changed LLM-conditioned edge ID, include every scenario whose `target_edge_ids` array contains that edge ID. These map 1:1 because the coverage guardrail enforces it:
      - `e_intent_to_faq` → `Routing: Intent→FAQ`
      - `e_intent_to_appt_menu` → `Routing: Intent→Appt`
      - `e_intent_to_escalate` → `Routing: Intent→Escalate` *and* `EdgeCase: Explicit Human Request`
      - `e_intent_to_goodbye` → `Routing: Intent→Done`
      - `e_faq_to_escalate` → `EdgeCase: FAQ Out-of-Scope Escalation`
      - `e_appt_menu_to_collect` → `Routing: ApptMenu→Create`
      - `e_appt_menu_to_list` → `Routing: ApptMenu→List`
      - `e_appt_menu_to_cancel` → `Routing: ApptMenu→Cancel`
      - `e_appt_menu_to_anything_else` → `Routing: ApptMenu→AnythingElse`
      - `e_verify_create_to_create` → `Routing: VerifyCreate→Create`
      - `e_verify_create_back_to_collect` → `Routing: VerifyCreate→BackToCollect`
      - `e_verify_create_to_anything_else` → `Routing: VerifyCreate→AnythingElse`
      - `e_verify_cancel_to_cancel` → `Routing: VerifyCancel→Cancel`
      - `e_verify_cancel_back_to_collect` → `Routing: VerifyCancel→BackToCollect`
      - `e_verify_cancel_to_anything_else` → `Routing: VerifyCancel→AnythingElse`
      - `e_anything_else_to_intent` → `Routing: AnythingElse→Intent` *and* `EdgeCase: Anything Else Loop Twice`
      - `e_anything_else_to_goodbye` → `Routing: AnythingElse→Goodbye`

   2. **Lifecycle nodes.** If any of these nodes changed (`n_collect_appt`, `n_verify_create`, `n_create_appt`, `n_confirm_book`, `n_suggest_alt`, `n_list_appt`, `n_show_appt`, `n_collect_cancel`, `n_verify_cancel`, `n_cancel_appt`, `n_confirm_cancel`), include `Lifecycle: Create→List→Cancel→List` — it exercises the full create→list→cancel→list chain end-to-end.

   3. **Node-content edits with no direct edge match.** For changes to node text/instructions on `n_greeting`, `n_faq`, `n_escalate`, `n_anything_else`, `n_goodbye`, `n_hangup`, or any other node not covered above: read each candidate scenario's `instructions` and `rubric` from `clinic-scenarios.ts` and include any scenario whose exercised path traverses the changed node. Use `assistant/conversation-flow.json` reachability to determine path traversal. Show your reasoning in the run report.

   4. **Changed edge with no scenario match.** The coverage guardrail (step 5) would have caught this and already halted — you should not reach this branch. If you do, stop and ask the user to add a scenario.

   5. **De-duplicate** the selected scenario names. Print the final list with the rationale per scenario (which node/edge change pulled it in).

   Run each selected scenario:
   ```bash
   npm run eval -- --scenario "<scenario name>"
   ```
   Each scenario takes ~30s; a subset of 2–5 finishes in ~3–5 min versus ~12 min for the full matrix.

8. **Report**

   After all selected scenarios finish, print:
   - Deployed assistant ID + webhook URL (from deploy output).
   - Scenario selection rationale: which node/edge change pulled in which scenario.
   - Pass/fail matrix: per scenario, per rubric criterion (the eval harness already prints this — surface it).
   - Coverage delta: which high-value LLM edges were exercised by the subset (versus the full 16).

   **If any criterion failed**: identify the root cause per the **Prompt authoring principles** above — do not narrowly patch a prompt just to pass the failing test. Work top-down: first check whether the root-level `instructions` or a shared edge `condition.prompt` is the right place for the fix (principles 1–2); only then consider a node-level instruction. State whether the fix is workflow-wide, subset-wide, or node-local, and why. Prefer a positive single-job framing over a "do NOT" list (principle 4). Suggest the concrete edit, name the file + field, and stop. Do not auto-commit.

   **If all passed**: summarize what was deployed + the eval coverage delta. Remind the user that committing requires an explicit go-ahead.

**Output During Deployment**

```
## Updating assistant workflow

[1/8] Preconditions: telnyx-edge auth ok, .env present
[2/8] Changed files: workflow/assistant.config.json
[3/8] Diff: n_faq instructions (1 node), e_faq_to_escalate condition text (1 edge)
[4/8] Synced assistant/conversation-flow.json
[5/8] Coverage guardrail: 16/16 edges covered ✓
[6/8] Deploy: `npm run deploy:assistant` (config-only change, no edge/ files)
       → Assistant updated: assistant-2fb940c7-...
[7/8] Selected 3 scenarios: EdgeCase: FAQ Out-of-Scope Escalation (e_faq_to_escalate),
     Routing: Intent→Escalate (no change but shares n_escalate path), Lifecycle
[8/8] Running eval...
```

**Output On Completion**

```
## Workflow Updated

**Assistant:** assistant-2fb940c7-fb3a-4a86-93c9-625c715f7237
**Webhook:** https://telnyx-webhook-4afc7aff-1.telnyxcompute.com/webhook
**Deploy:** npm run deploy:assistant (config-only)

### Eval Results (3/24 scenarios run)
- ✓ EdgeCase: FAQ Out-of-Scope Escalation: 2/2 criteria passed
- ✓ Routing: Intent→Escalate: 2/2 criteria passed
- ✓ Lifecycle: Create→List→Cancel→List: 5/5 criteria passed

### Coverage
- Edges exercised: e_intent_to_escalate, e_faq_to_escalate, e_verify_create_to_create,
  e_verify_cancel_to_cancel, e_anything_else_to_goodbye (5/16 high-value)
- Skipped: 11 routing scenarios + 4 remaining edge-cases (no relevant changes)

All selected scenarios passed. Review the diff and commit when ready.
```

**Output On Pause (Guardrail Failure)**

```
## Implementation Paused

**Reason:** Coverage guardrail failed — workflow drift detected.

### Uncovered edge IDs
- `e_new_node_to_anything_else` (added to n_new_node, LLM condition, no scenario)

**Options:**
1. Add a scenario to workflow/eval/clinic-scenarios.ts whose target_edge_ids includes `e_new_node_to_anything_else`
2. Remove the edge from workflow/assistant.config.json if it was added by mistake
3. Explicitly accept the gap (not recommended)

What would you like to do?
```

**Output On Pause (Eval Failure)**

```
## Implementation Paused

**Reason:** 1 scenario failed.

### Failed Scenario: EdgeCase: FAQ Out-of-Scope Escalation
- ✗ Escalated to human line: failed (assistant attempted to answer using FAQ content)
- ✓ Did not attempt to answer: passed

### Root-cause analysis (per Prompt authoring principles)
The assistant answered an out-of-scope question itself instead of routing to `n_escalate`. This is a routing responsibility issue, not an FAQ-content issue — so the fix belongs at the routing level, not the FAQ answer text.

- **Root-level `instructions`?** Not the best fit — escalation routing is specific to the FAQ node, not every node.
- **Edge `e_faq_to_escalate` condition?** Yes — the routing criterion is what decides whether the conversation leaves `n_faq` for `n_escalate`. If the condition text only matches "outside hours/location/services/fees" literally, it misses "insurance" / "billing". Widening the condition prompt is the composed fix (principle 2) — one edit, one place.
- **Node `n_faq` instructions?** Only if the edge condition is already correct; avoid adding a "do NOT answer insurance questions" negative case here (principle 4) — the edge condition is the positive framing.

**Suggested fix (one place, no duplication):**
- `workflow/assistant.config.json` → edge `e_faq_to_escalate` → `condition.prompt`: broaden to cover any question the FAQ content cannot answer (insurance, billing, medical advice), not just "not about hours/location/services/fees".

**Not suggested:** pasting "do NOT answer insurance/billing/medical questions" into `n_faq` instructions — negative list will drift as new out-of-scope topics appear (principle 4).

**Options:**
1. Apply the suggested edge-condition fix, redeploy, re-run: `npm run eval -- --scenario "EdgeCase: FAQ Out-of-Scope Escalation"`
2. Inspect the failing run's `logs` field first to confirm the model's actual behavior before editing
3. Propose a different fix level if the analysis above is wrong

What would you like to do?
```

**Guardrails**

- Always run the offline coverage guardrail (step 5) before live evals. It catches workflow drift for free; live evals cost real API spend.
- Keep `assistant/conversation-flow.json` in sync with `workflow/assistant.config.json` before running the guardrail. A stale snapshot silently hides drift.
- Never run the full 24-scenario matrix unless the change is high-level (model / dynamic_variables defaults / top-level metadata) OR the user explicitly asks for full re-eval.
- Never deploy with unresolved `PLACEHOLDER_*_TOOL_ID` strings outside `shared_tool_ids` arrays — `deploy:assistant` only replaces them inside those arrays. The hangup tool ID is real.
- Never auto-commit. Committing requires an explicit user go-ahead.
- Never log or commit `TELNYX_API_KEY` or any secret (per AGENTS.md).
- Do not fire this skill if only `edge/**` files changed (no assistant config edit) — that path isn't this skill's job.
- Do not fire if neither `workflow/assistant.config.json` nor `assistant/conversation-flow.json` is modified and the user did not name this skill or request a workflow update.
- If a deploy fails, stop and report the underlying error — do not retry blindly or proceed to evals against a stale assistant.
- If any rubric criterion fails, stop and suggest a fix. Do not auto-commit a broken workflow.
- Do not narrowly tune a prompt to pass one eval scenario — fix the root cause at the right level (root instruction → edge condition → node instruction) per the Prompt authoring principles. Do not paste the same rule into 3+ nodes; prefer the root instruction or a shared edge condition.
- Do not stack "do NOT" cases in a prompt to chase failing scenarios — prefer a positive single-job framing and reserve negatives for repeated, demonstrated confusion between two adjacent nodes.
