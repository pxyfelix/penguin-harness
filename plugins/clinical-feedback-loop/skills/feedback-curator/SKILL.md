---
name: feedback-curator
description: Use when importing colleague feedback, clustering issue reports, resolving duplicate or conflicting reports, preparing a weekly review, or publishing an approved Memory Pack.
version: 2026.10.21.4
---

# Feedback Curator

Curate evidence. Do not silently promote it into long-term Agent behavior.

## Initialization

Run once from this Skill's installed directory:

```bash
node scripts/feedback-cli.mjs init
```

This creates the Project feedback layout and copies the CLI, schemas and Excel template to:

```text
<app_data_dir>/<project>/feedback/tools/
```

Use the Project-local copy after initialization:

```bash
PROJECT_DIR="${PENGUIN_HOME}/${PENGUIN_PROJECT_ID}"
CLI="$PROJECT_DIR/feedback/tools/feedback-cli.mjs"
```

## Weekly Run

Process only the requested seven-day window.

1. Collect reports staged by tested Agents:

```bash
node "$CLI" sync-staged --project-dir "${PENGUIN_HOME}/${PENGUIN_PROJECT_ID}"
```

This is necessary because normal Agent sessions may write only their Workspace and scratchpad.

2. Import every new workbook under `imports/` in the central feedback Workspace with
   `import-excel`. Pass the importing
   colleague's `--user-id` and test round when known.
3. Run:

```bash
node "$CLI" review --from YYYY-MM-DD --to YYYY-MM-DD
```

4. Export the same window to one administrator workbook:

```bash
node "$CLI" export \
  --output "reviews/YYYY-MM-DD_YYYY-MM-DD/all-feedback.xlsx" \
  --from YYYY-MM-DD \
  --to YYYY-MM-DD
```

This workbook merges feedback from every user and every Agent. It is a generated view; the JSON
reports remain the source of truth.

5. Read `packet.json`, `packet.md` and `reports.jsonl`.
6. Create Issue Clusters in `clusters/<id>.json`. Merge only reports with the same
   capability, artifact or workflow step, failure mode, and likely root category.
7. Create Conflict Groups in `conflicts/<id>.json` when claims cannot all apply. Preserve
   every side and its evidence; do not use majority vote.
8. Never use `source: rsi_eval` as colleague experience.

Cluster ids start with `FC-`; conflict ids start with `CF-`. Keep their schemas in
`feedback/tools/schemas/`.

## Memory Candidate

Prepare Memory Candidates only from reviewed clusters. V0 permits:

- `scope: company`
- `scope: capability`

Do not create `scope: user`. A single reporter's preference cannot become a company rule without
an explicit administrator decision and rationale.

Write the candidate pack in a staging directory under `reviews/` with:

```text
manifest.json
MEMORY.md
entries/<entry-id>.md
changelog.md
```

Present the proposed rules and evidence to the administrator. Wait for explicit approval.

## Publication

After approval:

```bash
node "$CLI" publish \
  --source <staging-pack> \
  --version YYYY.MM.DD.N \
  --approved-by <administrator-user-id>
```

Publication must validate the manifest, immutable entries and content hash. A failed publication
leaves the previous active pack unchanged.

## Boundaries

- Do not train model weights.
- Do not modify the feedback Skill or RSI infrastructure.
- Do not read or copy secrets and controlled data into a pack.
- Do not publish raw reports.
- Do not merge unresolved conflicts.
