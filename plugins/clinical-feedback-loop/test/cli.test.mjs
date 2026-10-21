import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const cli = path.resolve(
  "plugins/clinical-feedback-loop/skills/feedback-curator/scripts/feedback-cli.mjs",
);

async function run(args, options = {}) {
  const result = await execFileAsync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    ...options,
  });
  return result.stdout.trim();
}

test("runs init, capture, list, CSV import and review from the CLI", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "clinical-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const common = ["--root", root, "--project", "pilot"];

  assert.deepEqual(JSON.parse(await run(["init", ...common])), {
    ok: true,
    initialized: true,
  });
  const projectCli = path.join(root, "pilot", "feedback", "tools", "feedback-cli.mjs");
  const reinitialized = await execFileAsync(
    process.execPath,
    [projectCli, "init", "--root", root, "--project", "pilot"],
    { encoding: "utf8", cwd: root },
  );
  assert.deepEqual(JSON.parse(reinitialized.stdout), {
    ok: true,
    initialized: true,
  });

  const issueFile = path.join(root, "issue.json");
  await writeFile(
    issueFile,
    JSON.stringify({
      source: "agent_capture",
      user_id: "user-a",
      agent_id: "sap_author",
      session_id: "session-a",
      capability: "sap-authoring",
      observed: "Observed from CLI",
      expected: "Expected from CLI",
      severity: "normal",
    }),
    "utf8",
  );
  const captured = JSON.parse(await run(["capture", ...common, "--input", issueFile]));
  assert.equal(captured.created, true);

  const listed = JSON.parse(await run(["list", ...common, "--json"]));
  assert.equal(listed.reports.length, 1);

  const csvFile = path.join(root, "feedback.csv");
  await writeFile(
    csvFile,
    "ID,Capability,Actual problem,Expected result,Severity,Evidence\nP01-001,SAP,CSV issue,CSV expected,High,evidence-a\n",
    "utf8",
  );
  assert.deepEqual(
    JSON.parse(await run(["import-csv", ...common, "--input", csvFile, "--user-id", "user-b"])),
    { imported: 1, duplicate: 0, invalid: 0 },
  );

  const review = JSON.parse(
    await run(["review", ...common, "--from", "2026-10-01", "--to", "2026-10-31"]),
  );
  assert.equal(review.reportCount, 2);
  const packet = JSON.parse(await readFile(path.join(review.outDir, "packet.json"), "utf8"));
  assert.equal(packet.reportCount, 2);

  const candidate = path.join(review.outDir, "candidate-pack");
  await mkdir(path.join(candidate, "entries"), { recursive: true });
  await writeFile(
    path.join(candidate, "manifest.json"),
    JSON.stringify({
      version: "2026.10.21.1",
      approvedBy: "admin",
      approvedAt: "2026-10-21T10:00:00.000Z",
      entries: [],
      contentHash: "0".repeat(64),
    }),
    "utf8",
  );
  await writeFile(path.join(candidate, "MEMORY.md"), "# Memory\n");
  await writeFile(path.join(candidate, "changelog.md"), "# Changelog\n");
  const published = JSON.parse(
    await run([
      "publish",
      ...common,
      "--source",
      candidate,
      "--version",
      "2026.10.21.1",
      "--approved-by",
      "admin",
    ]),
  );
  assert.equal(published.version, "2026.10.21.1");
  assert.equal(JSON.parse(await run(["active", ...common])).active.version, "2026.10.21.1");
});

test("uses PENGUIN_HOME and PENGUIN_PROJECT_ID defaults", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "clinical-cli-env-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = JSON.parse(
    await run(["init"], {
      env: {
        ...process.env,
        PENGUIN_HOME: root,
        PENGUIN_PROJECT_ID: "pilot",
      },
    }),
  );
  assert.deepEqual(result, { ok: true, initialized: true });
});

test("captures into a workspace-local staging store", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "clinical-cli-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = path.join(root, "feedback-staging");
  const issueFile = path.join(root, "issue.json");
  await writeFile(
    issueFile,
    JSON.stringify({
      source: "agent_capture",
      user_id: "user-a",
      agent_id: "sap_author",
      session_id: "session-a",
      capability: "sap-authoring",
      observed: "Workspace-local issue",
      expected: "Workspace-local expected",
      severity: "high",
    }),
    "utf8",
  );
  const result = JSON.parse(
    await run(["capture", "--store", store, "--project", "pilot", "--input", issueFile]),
  );
  assert.equal(result.created, true);
  assert.match(result.file.replaceAll("\\", "/"), /feedback-staging\/inbox\/user-a\//);
});
