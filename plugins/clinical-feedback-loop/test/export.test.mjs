import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  captureIssue,
  exportIssues,
  initStore,
  resolveContext,
} from "../skills/feedback-curator/scripts/lib/store.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "clinical-export-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ctx = resolveContext({ root, project: "pilot" }, {});
  await initStore(ctx);
  return ctx;
}

test("exports all users' feedback into one administrator CSV", async (t) => {
  const ctx = await fixture(t);
  await captureIssue(
    ctx,
    {
      source: "agent_capture",
      user_id: "felix",
      agent_id: "sap_author",
      session_id: "session-a",
      capability: "SAP",
      observed: "SAP issue",
      expected: "Expected SAP",
      severity: "High",
      evidence: [{ reference: "evidence-a" }],
    },
    new Date("2026-10-22T01:00:00.000Z"),
  );
  await captureIssue(
    ctx,
    {
      source: "agent_capture",
      user_id: "ashley",
      agent_id: "shell_author",
      session_id: "session-b",
      capability: "Table Shell",
      observed: "Shell issue",
      expected: "Expected shell",
      severity: "Normal",
    },
    new Date("2026-10-22T02:00:00.000Z"),
  );
  const result = await exportIssues(ctx, {
    output: path.join(ctx.feedbackDir, "all-feedback.csv"),
    from: "2026-10-22",
    to: "2026-10-22",
  });
  const text = await readFile(result.file, "utf8");
  assert.match(
    text,
    /^\ufeff?编号,填写人,Agent,能力,实际问题,期望结果,严重度,证据,状态,时间,Session/m,
  );
  assert.match(text, /felix/);
  assert.match(text, /ashley/);
  assert.match(text, /SAP issue/);
  assert.match(text, /Shell issue/);
});
