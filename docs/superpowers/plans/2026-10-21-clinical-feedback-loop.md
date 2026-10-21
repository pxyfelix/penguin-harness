# Clinical Feedback Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Status: implemented and verified on 2026-10-21; test candidates await administrator review.

**Goal:** Implement the first two stages of the approved clinical feedback design: low-friction feedback capture, Excel import, clustering inputs, conflict records, weekly review packets, and a versioned read-only Memory Pack.

**Architecture:** Ship a `clinical-feedback-loop` plugin containing three skills. Its curator skill carries a dependency-free Node CLI plus an Excel template and schemas. The CLI installs a self-contained copy of itself into each Project's `feedback/tools/` directory; every Agent skill invokes that Project-local copy, so installed skills never depend on plugin-cache paths.

**Tech Stack:** Node.js 24, built-in `node:test`, filesystem JSON/YAML-like manifests, LibreOffice headless for XLSX-to-CSV conversion, OpenPyXL only during template generation, PenguinHarness plugin format.

---

## File Structure

- `plugins/clinical-feedback-loop/package.json` — plugin manifest and metadata.
- `plugins/clinical-feedback-loop/icon.svg` — plugin icon.
- `plugins/clinical-feedback-loop/README.md` — install, initialize, and operation guide.
- `plugins/clinical-feedback-loop/skills/feedback-capture/SKILL.md` — worker-facing capture instructions.
- `plugins/clinical-feedback-loop/skills/feedback-curator/SKILL.md` — General Agent curation instructions.
- `plugins/clinical-feedback-loop/skills/feedback-curator/scripts/feedback-cli.mjs` — Project-local CLI entry.
- `plugins/clinical-feedback-loop/skills/feedback-curator/scripts/lib/store.mjs` — paths, validation, capture, import, review and publish primitives.
- `plugins/clinical-feedback-loop/skills/feedback-curator/scripts/lib/csv.mjs` — RFC 4180-compatible CSV reader/writer.
- `plugins/clinical-feedback-loop/skills/feedback-curator/templates/feedback.xlsx` — six-column colleague workbook.
- `plugins/clinical-feedback-loop/skills/feedback-curator/schemas/issue.schema.json` — Issue Report schema.
- `plugins/clinical-feedback-loop/skills/feedback-curator/schemas/cluster.schema.json` — Issue Cluster schema.
- `plugins/clinical-feedback-loop/skills/feedback-curator/schemas/conflict.schema.json` — Conflict Group schema.
- `plugins/clinical-feedback-loop/skills/feedback-curator/schemas/memory-pack.schema.json` — Memory Pack manifest schema.
- `plugins/clinical-feedback-loop/skills/curated-memory-reader/SKILL.md` — read-only worker knowledge lookup.
- `plugins/clinical-feedback-loop/test/csv.test.mjs` — CSV parsing and quoting tests.
- `plugins/clinical-feedback-loop/test/store.test.mjs` — init, capture, duplicate and validation tests.
- `plugins/clinical-feedback-loop/test/import.test.mjs` — Excel/CSV row normalization and idempotence tests.
- `plugins/clinical-feedback-loop/test/curation.test.mjs` — review packet, conflict validation and Memory Pack publication tests.
- `plugins/clinical-feedback-loop/scripts/make-feedback-template.py` — reproducible OpenPyXL template generator.

## Task 1: Scaffold the Plugin

**Files:**

- Create: `plugins/clinical-feedback-loop/package.json`
- Create: `plugins/clinical-feedback-loop/icon.svg`
- Create: `plugins/clinical-feedback-loop/README.md`
- Create: the empty `skills/` and `schemas/` directories through files added in later tasks.

- [ ] **Step 1: Add the plugin manifest**

Set package name `@penguinharness/clinical-feedback-loop`, version `0.2.16`, category
`office-productivity`, `preinstall: false`, and include `skills`, `scripts`, `schemas`, `test`,
`icon.svg`, `README.md` and `LICENSE` in `files`.

- [ ] **Step 2: Add a simple SVG icon and README**

The README must describe:

```text
1. Install feedback-capture on tested Agents.
2. Install feedback-curator on the General Agent.
3. Install curated-memory-reader on tested Agents.
4. Run the curator CLI `init` once from an administrator session.
5. Create the weekly schedule owned by the General Agent.
```

- [ ] **Step 3: Verify package metadata**

Run:

```powershell
Get-Content -Raw plugins/clinical-feedback-loop/package.json | ConvertFrom-Json
```

Expected: valid JSON with `penguin.category = "office-productivity"`.

## Task 2: CSV and Store Primitives

**Files:**

- Create: `plugins/clinical-feedback-loop/test/csv.test.mjs`
- Create: `plugins/clinical-feedback-loop/test/store.test.mjs`
- Create: `plugins/clinical-feedback-loop/skills/feedback-curator/scripts/lib/csv.mjs`
- Create: `plugins/clinical-feedback-loop/skills/feedback-curator/scripts/lib/store.mjs`

- [ ] **Step 1: Write failing CSV tests**

Cover quoted commas, escaped quotes, CRLF, blank rows and a round trip:

```js
assert.deepEqual(parseCsv('a,"b,c",d\r\n"x""y",z,\r\n'), [
  ["a", "b,c", "d"],
  ["x\"y", "z", ""],
]);
```

- [ ] **Step 2: Run the CSV test and watch it fail**

Run:

```powershell
node --test plugins/clinical-feedback-loop/test/csv.test.mjs
```

Expected: failure because `scripts/lib/csv.mjs` does not exist.

- [ ] **Step 3: Implement the CSV reader/writer**

Implement `parseCsv(text)` and `toCsv(rows)` with RFC 4180 quoting and no dependencies.

- [ ] **Step 4: Write failing store tests**

Cover:

- `initStore()` creates all seven feedback directories.
- `captureIssue()` writes exactly one JSON file and derives `agent_id`, `session_id`, `user_id`
  from explicit values when environment values are absent.
- Capturing the same fingerprint twice returns the same ID and does not create a second file.
- Missing `observed` or invalid severity fails before any file is written.
- `listIssues()` skips malformed JSON into `quarantine` instead of crashing.

- [ ] **Step 5: Run store tests and watch them fail**

Run:

```powershell
node --test plugins/clinical-feedback-loop/test/store.test.mjs
```

Expected: import failure because `store.mjs` does not exist.

- [ ] **Step 6: Implement minimal store primitives**

Export:

```js
resolveContext(args, env)
initStore(ctx)
captureIssue(ctx, input)
listIssues(ctx, options)
writeJsonExclusive(file, value)
```

Use the directory layout from the design. IDs and path segments accept only
`^[A-Za-z0-9_-]+$`. Use exclusive writes (`flag: "wx"`) and a SHA-256 fingerprint over source,
user, agent, session, capability, observed and expected.

- [ ] **Step 7: Run tests to green**

Run:

```powershell
node --test plugins/clinical-feedback-loop/test/csv.test.mjs plugins/clinical-feedback-loop/test/store.test.mjs
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```powershell
git add plugins/clinical-feedback-loop
git commit -m "feat(plugin): add clinical feedback store primitives"
```

## Task 3: Excel Template and Import

**Files:**

- Create: `plugins/clinical-feedback-loop/scripts/make-feedback-template.py`
- Create: `plugins/clinical-feedback-loop/skills/feedback-curator/templates/feedback.xlsx`
- Create: `plugins/clinical-feedback-loop/test/import.test.mjs`
- Modify: `plugins/clinical-feedback-loop/skills/feedback-curator/scripts/lib/store.mjs`

- [ ] **Step 1: Write failing import tests**

Test conversion of this row:

```csv
ID,Capability,Actual problem,Expected result,Severity,Evidence
P02-004,Table Shell,主要终点表没有分析人群,明确 ITT 和 Week 12,High,P02-SHELL-R1
```

Expected Issue Report:

```json
{
  "id": "P02-004",
  "source": "excel",
  "capability": "tfl-shell-authoring",
  "observed": "主要终点表没有分析人群",
  "expected": "明确 ITT 和 Week 12",
  "severity": "high",
  "evidence": [{"reference": "P02-SHELL-R1"}]
}
```

Also test that importing the same CSV twice creates one report.

- [ ] **Step 2: Run import tests and watch them fail**

Run:

```powershell
node --test plugins/clinical-feedback-loop/test/import.test.mjs
```

Expected: failure because `importCsv()` is missing.

- [ ] **Step 3: Implement CSV import**

Add `importCsv(ctx, rows, options)` and `importExcel(ctx, path, options)`. The latter uses
LibreOffice headless to convert `.xlsx` to CSV in a temporary directory. Normalize capability
labels to:

```text
CRF Review -> crf-review
SAP -> sap-authoring
Table Shell -> tfl-shell-authoring
Workflow -> workflow
Other -> other
```

- [ ] **Step 4: Generate the workbook**

Use:

```powershell
& 'E:\Project\sap\.venv\Scripts\python.exe' plugins/clinical-feedback-loop/scripts/make-feedback-template.py plugins/clinical-feedback-loop/skills/feedback-curator/templates/feedback.xlsx
```

The sheet `反馈` must contain six headers, one example row, dropdown validation for Capability
and Severity, frozen header row, wrapped text and sensible column widths. The sheet `说明`
must describe the three substantive fields and the source of automatic metadata.

- [ ] **Step 5: Verify the workbook and import path**

Run:

```powershell
& 'E:\Project\sap\.venv\Scripts\python.exe' -c "from openpyxl import load_workbook; w=load_workbook(r'plugins/clinical-feedback-loop/skills/feedback-curator/templates/feedback.xlsx'); print(w.sheetnames, w['反馈'].max_column, w['反馈'].max_row)"
```

Expected: `['反馈', '填写说明', '示例'] 6 500`.

- [ ] **Step 6: Run tests**

```powershell
node --test plugins/clinical-feedback-loop/test/import.test.mjs
```

Expected: all import tests pass.

- [ ] **Step 7: Commit**

```powershell
git add plugins/clinical-feedback-loop
git commit -m "feat(plugin): import colleague feedback from Excel"
```

## Task 4: Review Packets and Curated Memory Packs

**Files:**

- Create: `plugins/clinical-feedback-loop/test/curation.test.mjs`
- Modify: `plugins/clinical-feedback-loop/skills/feedback-curator/scripts/lib/store.mjs`
- Create: `plugins/clinical-feedback-loop/skills/feedback-curator/schemas/cluster.schema.json`
- Create: `plugins/clinical-feedback-loop/skills/feedback-curator/schemas/conflict.schema.json`
- Create: `plugins/clinical-feedback-loop/skills/feedback-curator/schemas/memory-pack.schema.json`

- [ ] **Step 1: Write failing curation tests**

Cover:

- `buildReviewPacket()` excludes `source: rsi_eval`.
- It writes a deterministic report index ordered by `created_at`, then `id`.
- Invalid cluster or conflict JSON stays on disk but is listed as invalid in the packet.
- `publishMemoryPack()` refuses a missing `MEMORY.md`, missing approver, malformed manifest or
  version conflict.
- Successful publication copies the pack and atomically updates `active-memory-pack.json`.
- A failed publication leaves the previous active pointer unchanged.

- [ ] **Step 2: Run tests and watch them fail**

```powershell
node --test plugins/clinical-feedback-loop/test/curation.test.mjs
```

Expected: failure because the curation and publication functions are missing.

- [ ] **Step 3: Implement review packet generation**

Add:

```js
buildReviewPacket(ctx, { from, to, outDir })
publishMemoryPack(ctx, { sourceDir, version, approvedBy })
```

The packet contains `packet.json`, `packet.md` and `reports.jsonl`. Group by capability and
include counts, malformed reports, unresolved conflicts and report IDs. The curator writes
semantic clusters and conflicts as JSON after reading these inputs.

- [ ] **Step 4: Implement Memory Pack validation and publication**

A pack must contain:

```text
manifest.json
MEMORY.md
entries/*.md
changelog.md
```

The manifest must include `version`, `approvedBy`, `approvedAt`, `entries` and `contentHash`.
Publish by copying to a temporary sibling, verifying, renaming to the final version, then
atomically replacing `active-memory-pack.json`.

- [ ] **Step 5: Run tests**

```powershell
node --test plugins/clinical-feedback-loop/test/curation.test.mjs
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```powershell
git add plugins/clinical-feedback-loop
git commit -m "feat(plugin): publish weekly curated memory packs"
```

## Task 5: Skills and CLI

**Files:**

- Create: `plugins/clinical-feedback-loop/skills/feedback-capture/SKILL.md`
- Create: `plugins/clinical-feedback-loop/skills/feedback-curator/SKILL.md`
- Create: `plugins/clinical-feedback-loop/skills/curated-memory-reader/SKILL.md`
- Create: `plugins/clinical-feedback-loop/skills/feedback-curator/scripts/feedback-cli.mjs`
- Create: `plugins/clinical-feedback-loop/test/cli.test.mjs`

- [ ] **Step 1: Write failing CLI tests**

Run each command against a temporary root:

```powershell
node feedback-cli.mjs init --root <tmp> --project test
node feedback-cli.mjs capture --root <tmp> --project test --input issue.json
node feedback-cli.mjs list --root <tmp> --project test --json
node feedback-cli.mjs import-csv --root <tmp> --project test --input feedback.csv --user-id u1
node feedback-cli.mjs review --root <tmp> --project test --from 2026-10-01 --to 2026-10-31
```

Expected: stable JSON output, exit 0, and files in the documented locations.

- [ ] **Step 2: Implement the CLI**

Support subcommands `init`, `capture`, `list`, `import-csv`, `import-excel`, `review`, `publish`,
and `active`. All accept `--root` and `--project`; when omitted, use `PENGUIN_HOME` and
`PENGUIN_PROJECT_ID`. Errors exit nonzero and print only a compact JSON error.

- [ ] **Step 3: Write the three Skill instructions**

`feedback-capture` must:

- trigger on explicit recording words or clear corrections;
- resolve `<project>/feedback/tools/feedback-cli.mjs`;
- create one JSON input file in the Session scratchpad and run `capture`;
- preserve the user's exact wording, observed behavior, expected behavior and evidence;
- never write Memory, Prompt or another Agent's state.

`feedback-curator` must:

- process only the requested date window;
- import Excel first and run `review`;
- cluster by capability, artifact, failure mode and root category;
- preserve conflicts rather than forcing consensus;
- ask for approval and run `publish` only after the administrator replies;
- never train model weights or modify RSI infrastructure.

`curated-memory-reader` must:

- read `active-memory-pack.json`;
- read only the selected pack's `MEMORY.md` index;
- use entries only when relevant;
- never modify the pack or promote new memory.

- [ ] **Step 4: Run CLI and Skill validation**

```powershell
node --test plugins/clinical-feedback-loop/test/cli.test.mjs
pnpm exec prettier --check plugins/clinical-feedback-loop
pnpm exec oxlint plugins/clinical-feedback-loop
```

Expected: all tests and checks pass.

- [ ] **Step 5: Commit**

```powershell
git add plugins/clinical-feedback-loop
git commit -m "feat(plugin): add clinical feedback skills and CLI"
```

## Task 6: Install and Initialize the Pilot

**Files:**

- Modify on server only: `clinical_capability_pilot/feedback/**`
- Agent skill state on server only.
- General Agent schedule on server only.

- [ ] **Step 1: Package and install the three skills**

Install:

- `feedback-capture` on `qc_reviewer`, `sap_author`, `shell_author`, `lead_statistician`.
- `feedback-curator` on `default_agent`.
- `curated-memory-reader` on all five Agents.

- [ ] **Step 2: Initialize the Project store**

Run the installed curator CLI with:

```powershell
node <installed-curator-skill>/scripts/feedback-cli.mjs init --root /home/ubuntu/.penguin/data-multiuser-test --project clinical_capability_pilot
```

Expected directories:

```text
feedback/inbox
feedback/normalized
feedback/clusters
feedback/conflicts
feedback/reviews
feedback/decisions
feedback/memory-packs
feedback/tools
```

The command also copies the CLI, template and schemas into `feedback/tools/`.

- [ ] **Step 3: Add the weekly schedule**

Create the General Agent schedule for Monday 02:00 Asia/Shanghai. Its prompt starts the
`feedback-curator` Skill, processes the previous seven days, writes a review packet and asks the
Project owner to approve or reject Memory Candidates.

- [ ] **Step 4: Verify installation**

Use the API to confirm each Agent has the expected skills, all Memory switches remain false,
the General Agent has exactly one enabled weekly schedule, and the feedback directory exists.

## Task 7: End-to-End Verification

**Files:**

- No source changes expected.

- [ ] **Step 1: Test conversational capture**

Open a new Session with `sap_author`, give it one explicit feedback correction, and verify:

- one Issue Report appears in the current user's inbox;
- source, agent, session, capability, observed and expected are populated;
- no Memory or Skill file changed.

- [ ] **Step 2: Test Excel import**

Copy `feedback.xlsx`, fill two rows with distinct issues, import it, then re-import it. Verify
two reports exist after both runs and the second run creates no duplicates.

- [ ] **Step 3: Test clustering and conflict handling**

Create two similar reports and one contradictory report. Run the curator with an administrator
request. Verify:

- similar reports share one cluster;
- the contradictory report is in a Conflict Group;
- no Memory Candidate or active pack changes before approval.

- [ ] **Step 4: Test Memory Pack publication**

Approve one candidate, publish version `2026.10.28.1`, and verify:

- `active-memory-pack.json` points to that version;
- `MEMORY.md` and every manifest entry exist;
- the hash matches;
- no raw report was modified.

- [ ] **Step 5: Verify isolation and RSI boundaries**

Run as a colleague account and confirm:

- the colleague cannot read another inbox;
- the colleague can read only the active pack;
- RSI-authored issues tagged `rsi_eval` do not enter review packets;
- disabled native Memory remains disabled.

- [ ] **Step 6: Commit any fixes and report evidence**

Run the complete plugin test command:

```powershell
node --test plugins/clinical-feedback-loop/test/*.test.mjs
```

Commit fixes with:

```powershell
git add plugins/clinical-feedback-loop
git commit -m "fix(plugin): harden clinical feedback loop"
```
