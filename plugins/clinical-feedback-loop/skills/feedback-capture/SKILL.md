---
name: feedback-capture
description: Use when a user explicitly reports, corrects, rejects, or asks to record a problem in an Agent deliverable or workflow.
version: 2026.10.21.2
---

# Feedback Capture

Record the report as evidence. Do not decide that it is a permanent rule.

## Trigger

Use this Skill when the user says “record”, “log this”, “this is wrong”, “it should be”, or
clearly corrects the Agent's factual result, format, or procedure.

Do not record small talk, explored alternatives, or the Agent's own guess.

## Capture

1. Preserve the user's exact wording and separate it from your paraphrase.
2. Capture one issue per report. If the expected behavior is unclear, ask one concise question.
3. Write a JSON input file in the Session scratchpad with:

```json
{
  "source": "agent_capture",
  "capability": "sap-authoring",
  "severity": "high",
  "observed": "What actually happened",
  "expected": "What the reporter expected",
  "category": "unsupported_claim",
  "evidence": [
    { "artifact": "outputs/sap-draft.docx", "locator": "Section 8.5" }
  ],
  "root_cause_hint": ["skill", "prompt"],
  "sensitivity": "internal"
}
```

Allowed capability labels are `CRF Review`, `SAP`, `Table Shell`, `Workflow` and `Other`.
Allowed severities are `Blocker`, `High`, `Normal` and `Low`.

4. Run the Project-local CLI against a staging store inside the current writable Workspace:

```bash
PROJECT_DIR="${PENGUIN_HOME}/${PENGUIN_PROJECT_ID}"
node "$PROJECT_DIR/feedback/tools/feedback-cli.mjs" capture \
  --store "$PWD/feedback-staging" \
  --project "$PENGUIN_PROJECT_ID" \
  --input <scratchpad-json>
```

5. Return the resulting feedback id and file path.

The Project feedback directory is intentionally not writable from a normal Agent session. The
weekly curator collects `feedback-staging` from Agent workspaces into the central store.

## Boundaries

- Never edit `agent_state/memory`, another Agent's State, a Skill, a Prompt or a Hook.
- Never put credentials, PHI or controlled study data in the report.
- If the CLI is absent, tell the administrator to initialize `feedback-curator`; do not invent a
  second storage format.
- A report is not approved knowledge. Only the curator and administrator can promote it.
