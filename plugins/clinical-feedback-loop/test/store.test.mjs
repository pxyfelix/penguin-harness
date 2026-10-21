import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  captureIssue,
  initStore,
  listIssues,
  resolveContext,
} from "../skills/feedback-curator/scripts/lib/store.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "clinical-feedback-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ctx = resolveContext({ root, project: "pilot" }, {});
  return { root, ctx };
}

test("initializes the feedback layout", async (t) => {
  const { ctx } = await fixture(t);
  await initStore(ctx);
  const entries = await readdir(ctx.feedbackDir);
  assert.deepEqual(entries.sort(), [
    "README.md",
    "clusters",
    "conflicts",
    "decisions",
    "imports",
    "inbox",
    "memory-packs",
    "normalized",
    "quarantine",
    "reviews",
    "tools",
  ]);
});

test("captures one normalized issue report", async (t) => {
  const { ctx } = await fixture(t);
  await initStore(ctx);
  const result = await captureIssue(ctx, {
    source: "agent_capture",
    user_id: "user-a",
    agent_id: "sap_author",
    session_id: "session-1",
    capability: "SAP",
    observed: "The SAP used an unsupported method.",
    expected: "Keep the method unresolved.",
    severity: "high",
    evidence: [{ artifact: "outputs/sap.docx", locator: "Section 8" }],
  });
  assert.equal(result.created, true);
  const report = JSON.parse(await readFile(result.file, "utf8"));
  assert.equal(report.id, result.id);
  assert.equal(report.capability, "sap-authoring");
  assert.equal(report.observed, "The SAP used an unsupported method.");
  assert.equal(report.expected, "Keep the method unresolved.");
  assert.equal(report.status, "new");
});

test("deduplicates the same issue fingerprint", async (t) => {
  const { ctx } = await fixture(t);
  await initStore(ctx);
  const input = {
    source: "agent_capture",
    user_id: "user-a",
    agent_id: "sap_author",
    session_id: "session-1",
    capability: "sap-authoring",
    observed: "The SAP used an unsupported method.",
    expected: "Keep the method unresolved.",
    severity: "high",
  };
  const first = await captureIssue(ctx, input);
  const second = await captureIssue(ctx, input);
  assert.equal(first.id, second.id);
  assert.equal(second.created, false);
  const dayDir = path.dirname(first.file);
  assert.equal((await readdir(dayDir)).length, 1);
});

test("rejects invalid input before writing", async (t) => {
  const { ctx } = await fixture(t);
  await initStore(ctx);
  await assert.rejects(
    captureIssue(ctx, {
      source: "agent_capture",
      user_id: "user-a",
      agent_id: "sap_author",
      session_id: "session-1",
      capability: "sap-authoring",
      observed: "",
      severity: "high",
    }),
    /observed/,
  );
  const inbox = await readdir(ctx.inboxDir);
  assert.deepEqual(inbox, []);
});

test("lists valid reports and quarantines malformed JSON", async (t) => {
  const { ctx } = await fixture(t);
  await initStore(ctx);
  const result = await captureIssue(ctx, {
    source: "agent_capture",
    user_id: "user-a",
    agent_id: "sap_author",
    session_id: "session-1",
    capability: "sap-authoring",
    observed: "Observed",
    expected: "Expected",
    severity: "normal",
  });
  const badDir = path.dirname(result.file);
  await writeFile(path.join(badDir, "broken.json"), "{not-json", "utf8");
  const listing = await listIssues(ctx);
  assert.equal(listing.reports.length, 1);
  assert.equal(listing.invalid.length, 1);
  assert.match(listing.invalid[0], /broken\.json$/);
});
