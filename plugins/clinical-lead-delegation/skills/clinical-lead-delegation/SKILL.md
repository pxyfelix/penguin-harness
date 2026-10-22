---
name: clinical-lead-delegation
description: Use when Lead Statistician must route CRF, SAP, or Table Shell work to project Agents, especially when two or more deliverables are independent or must be cross-checked.
version: 2026.10.22.2
---

# Clinical Lead Delegation

Lead Statistician coordinates and reviews. The authors write their own deliverables.

## Route

First run `penguin agent ls --json` in the current Project. Use the actual Agent ids; never guess them.

| Work | Agent |
| --- | --- |
| CRF or protocol review | `qc_reviewer` |
| SAP authoring | `sap_author` |
| Table Shell authoring | `shell_author` |

Do not send authoring work to QC, and do not do authoring work yourself. If a requested target is missing or two targets are equally valid, stop and ask the administrator.

## Prepare shared inputs

Files attached by the user live in the Lead Session's scratchpad. A child Agent shares the Workspace, not the parent Session's scratchpad.

Before dispatch, copy every input a child needs into:

```text
handoffs/<run_id>/inputs/
```

Give child Agents only those shared Workspace paths. Never ask a child to read a parent scratchpad path.

## Dispatch

- Use `run_subagent` with the selected `agent_id`.
- Start every child prompt with `Caller agent: lead_statistician`.
- Include the shared input paths, task, acceptance criteria, and output directory.
- Give each child `handoffs/<run_id>/<agent_id>/`; never let them write the same output file.
- For independent SAP and Table Shell work, prepare both prompts first and emit both `run_subagent` calls, each with `run_in_background: true`, in the same assistant turn. Do not wait for the first tool result before issuing the second.
- Capture both `subagent_id` values before waiting for either child's final answer.
- If the trace shows the first child speaking or completing before the second call was issued, report `dispatch_mode: sequential`; never call it parallel.
- Use `input_subagent` to poll or continue a background child. Do not claim completion until its final reply is observed.
- A Lead Statistician may delegate one additional level to specialist Agents. A specialist child at depth 2 cannot delegate again.

## Consolidate

Preserve each child's Agent id, subagent id, status, output paths, and unresolved decisions.

Compare SAP and Table Shell populations, endpoints, visits, methods, footnotes, and numbering. Report conflicts instead of merging them silently.

Distinguish a routing or file-access failure from a content inconsistency.

Return a compact JSON handoff containing `dispatch_mode`, `selected_agent_ids`, `subagent_ids`, `statuses`, `inputs`, `outputs`, and `consistency_findings`.
