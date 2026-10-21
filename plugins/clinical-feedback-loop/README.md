# Clinical Feedback Loop

This plugin implements the test-stage feedback loop described in
`docs/superpowers/specs/2026-10-21-feedback-memory-curation-design.md`.

## Installation

1. Install `feedback-capture` on every tested Agent.
2. Install `feedback-curator` on the General Agent.
3. Install `curated-memory-reader` on every Agent that should use approved knowledge.
4. From an administrator session, run the curator CLI's `init` command once.
5. Create a weekly General Agent schedule that runs `feedback-curator` over the previous seven
   days.

Initialization installs a self-contained CLI, schemas and Excel template under:

```text
<app_data_dir>/<project>/feedback/tools/
```

The installed skills always call that Project-local copy.

## Commands

```text
node feedback-cli.mjs init
node feedback-cli.mjs capture --input issue.json
node feedback-cli.mjs list --json
node feedback-cli.mjs import-csv --input feedback.csv --user-id <user>
node feedback-cli.mjs import-excel --input feedback.xlsx --user-id <user>
node feedback-cli.mjs review --from YYYY-MM-DD --to YYYY-MM-DD
node feedback-cli.mjs publish --source <review-pack-dir> --version YYYY.MM.DD.N --approved-by <user>
node feedback-cli.mjs active
```

`--root` and `--project` default to `PENGUIN_HOME` and `PENGUIN_PROJECT_ID`.

## Separation

- Feedback is raw evidence and is never injected into an Agent context automatically.
- Clusters and conflicts are curation artifacts.
- Only an approved, hashed and versioned Memory Pack becomes read-only shared knowledge.
- RSI may consume reviewed Benchmark Cases, never unreviewed feedback.
