---
name: clinical-task-routing
description: Use when a request involves clinical statistical deliverables such as CRF or protocol review, SAP authoring, revision or review, Table Shell generation or review, or several related statistical outputs that need coordination.
version: 2026.10.22.1
---

# Clinical Task Routing

The General Agent is the entry point. Statistical deliverables belong to the Project's clinical
statistical team.

## Route

For a real clinical statistical deliverable, delegate to `lead_statistician` with
`run_subagent`. Do not author, revise, or review the statistical document yourself.

This applies to:

- CRF or protocol review with statistical implications;
- SAP authoring, revision, or review;
- Table Shell generation or review;
- a request that combines SAP and Table Shell work;
- a task that needs more than one statistical specialist.

Answer directly only when the user asks for a general explanation and does not ask for a
document-level deliverable.

## Prepare shared inputs

Files attached to your prompt live in the General Agent Session's scratchpad. A child Agent
shares the Workspace, not the parent Session's scratchpad.

Before dispatch:

1. Create `handoffs/<run_id>/inputs/` in the Workspace.
2. Copy every attachment the clinical team needs into that directory.
3. Give the Lead Statistician only those shared Workspace paths.

Never pass a parent scratchpad path to the Lead or another child Agent.

## Dispatch

Call `run_subagent` with:

- `agent_id: "lead_statistician"`;
- a prompt opening with `Caller agent: default_agent`;
- the exact shared input paths;
- the user's requested deliverables and acceptance criteria;
- an output directory under `handoffs/<run_id>/lead/`;
- an instruction to use `clinical-lead-delegation` and dispatch specialist Agents.

For long or multi-deliverable work, use `run_in_background: true`. Keep the returned
`subagent_id` and wait for the Lead's final response before reporting completion.

## Consolidate

Preserve the Lead's dispatch mode, selected specialist Agents, subagent ids, statuses, output
paths, unresolved decisions, and consistency findings.

Verify that the final files exist in the Workspace before returning them to the user.
