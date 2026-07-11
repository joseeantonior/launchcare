# Hackathon notes

Strategy notes for the event — not needed to run the project.

## Remaining checklist

1. Fill every `EDIT` in `backend/policy/policy.md` with your real numbers;
   commit and `git tag v0.1` — version tags are what makes run-diffing and
   the eval trend chart meaningful.
2. Register the 4 roles ([usage.md](usage.md) §3 — one script command).
3. Fix the `actionlayer_reply` schema gap (`info`/`field_values`) so the
   escalate→resume loop works live.
4. Restricted-scope Stripe key; decide the support inbox; collect the env
   vars in [usage.md](usage.md) §5.
5. Draft (don't post) the launch-post skeleton for the H7 cross-track hour.

## Rubric math this pack sets up

- Working product 20x: real inbox + real Stripe + policy decisions = L4 by
  mid-day; exception-only escalation via ActionLayer resume-loop = L5 (80).
  Every judging-time ticket resolved = +20 overflow. Success definition:
  policy-correct escalation counts as success (run status `escalated`).
- Org 5x: plans with justified `skipped` lanes beat the L2 skip-test;
  review bounces are `revision_request` steps; `spawn_role` in a trace is
  the L5 artifact (15-20).
- Observability 7x: tree + tokens + cost + filter = L4 (21); alerts table +
  side-by-side getRunTree diff + listRuns search = L5 (28).
- Evals 5x: named set (20) run per version = L3 (10); baseline gate wired
  into your merge flow = L4 (15).
- Memory 2x: now (ticket) + past (customerContext) + rules (policy.md) =
  the three layers L5 names (8). T18 proves it live.
- Cost 1x: budgets in prompt + per-step cost in trace = provable L4 (3).
- Mgmt UI 1x: createRole form + settings editor (4 if the volunteer lands).

## Mentor drills — have the click-path ready

1. "Show me a run from this morning" → Runs tab → click the run.
2. "Which agent spent the most?" → Cost by agent tab.
3. "Give it a task that should skip a step" → run T07 live; show the plan's
   `skipped` line for billing.
4. "Show me a bounce" → any run where qa_reviewer returned `bounce`
   (T10's first draft usually earns one) → the `revision_request` step.
5. "Show me an alert that fired" → Alerts tab (set `costSpikeUsd` low once
   in the Settings tab during testing to guarantee a real row).
6. "Explain this regression" → two `results-*.json` + the 2-run diff view
   (check two runs in the Runs tab).

## Cautions

- Disclose the ActionLayer affiliation to mentors upfront.
- Volunteer UI test runs against a demo role, never the live DeepAI queue.
- PII masked in every judge-visible surface (`s***@gmail.com`).
- Calls over browser automation for real-world tasks.
- Keep Hermes session receipts even though you qualify via base-harness.
