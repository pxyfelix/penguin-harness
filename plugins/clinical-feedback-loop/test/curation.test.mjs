import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildReviewPacket,
  captureIssue,
  initStore,
  publishMemoryPack,
  resolveContext,
} from "../skills/feedback-curator/scripts/lib/store.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "clinical-curation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ctx = resolveContext({ root, project: "pilot" }, {});
  await initStore(ctx);
  return ctx;
}

async function report(ctx, overrides = {}) {
  return captureIssue(
    ctx,
    {
      source: "agent_capture",
      user_id: "user-a",
      agent_id: "sap_author",
      session_id: "session-a",
      capability: "sap-authoring",
      observed: "Observed issue",
      expected: "Expected result",
      severity: "high",
      ...overrides,
    },
    new Date("2026-10-21T10:00:00.000Z"),
  );
}

async function packSource(ctx) {
  const source = path.join(ctx.reviewsDir, "pending-pack");
  await mkdir(path.join(source, "entries"), { recursive: true });
  await writeFile(
    path.join(source, "manifest.json"),
    JSON.stringify({
      version: "2026.10.28.1",
      approvedBy: "admin",
      approvedAt: "2026-10-28T02:00:00.000Z",
      entries: [
        {
          id: "MEM-001",
          title: "Keep missing methods unresolved",
          scope: "capability",
          capability: "sap-authoring",
          file: "entries/MEM-001.md",
          source_report_ids: ["FB-1"],
        },
      ],
      contentHash: "0".repeat(64),
    }),
    "utf8",
  );
  await writeFile(path.join(source, "MEMORY.md"), "# Memory\n- [MEM-001](entries/MEM-001.md)\n");
  await writeFile(
    path.join(source, "entries", "MEM-001.md"),
    "# Keep missing methods unresolved\n",
  );
  await writeFile(path.join(source, "changelog.md"), "# Changelog\n- Initial pack\n");
  return source;
}

test("builds a deterministic packet and excludes RSI feedback", async (t) => {
  const ctx = await fixture(t);
  await report(ctx, { observed: "Normal report" });
  await report(ctx, {
    source: "rsi_eval",
    session_id: "session-rsi",
    observed: "Synthetic evaluation report",
  });
  const outDir = path.join(ctx.reviewsDir, "2026-10-21");
  const packet = await buildReviewPacket(ctx, {
    from: "2026-10-01",
    to: "2026-10-31",
    outDir,
  });
  assert.equal(packet.reportCount, 1);
  assert.equal(packet.reports[0].observed, "Normal report");
  const json = JSON.parse(await readFile(path.join(outDir, "packet.json"), "utf8"));
  assert.equal(json.reportCount, 1);
  const jsonl = await readFile(path.join(outDir, "reports.jsonl"), "utf8");
  assert.equal(jsonl.trim().split("\n").length, 1);
});

test("lists malformed cluster files without failing the packet", async (t) => {
  const ctx = await fixture(t);
  await report(ctx);
  await writeFile(path.join(ctx.clustersDir, "broken.json"), "{oops", "utf8");
  const packet = await buildReviewPacket(ctx, {
    from: "2026-10-01",
    to: "2026-10-31",
    outDir: path.join(ctx.reviewsDir, "bad-cluster"),
  });
  assert.equal(packet.invalidClusters.length, 1);
});

test("publishes an approved pack and updates the active pointer", async (t) => {
  const ctx = await fixture(t);
  const source = await packSource(ctx);
  const published = await publishMemoryPack(
    ctx,
    {
      sourceDir: source,
      version: "2026.10.28.1",
      approvedBy: "admin",
    },
    new Date("2026-10-28T03:00:00.000Z"),
  );
  const active = JSON.parse(await readFile(ctx.activePackFile, "utf8"));
  assert.equal(active.version, "2026.10.28.1");
  assert.equal(active.contentHash, published.contentHash);
  assert.equal(
    await readFile(path.join(published.dir, "MEMORY.md"), "utf8"),
    "# Memory\n- [MEM-001](entries/MEM-001.md)\n",
  );
});

test("rejects publication without an approver or MEMORY.md", async (t) => {
  const ctx = await fixture(t);
  const source = await packSource(ctx);
  await assert.rejects(
    publishMemoryPack(ctx, {
      sourceDir: source,
      version: "2026.10.28.1",
      approvedBy: "",
    }),
    /approvedBy/,
  );
  await rm(path.join(source, "MEMORY.md"));
  await assert.rejects(
    publishMemoryPack(ctx, {
      sourceDir: source,
      version: "2026.10.28.1",
      approvedBy: "admin",
    }),
    /MEMORY\.md/,
  );
});

test("failed publication leaves the previous active pointer unchanged", async (t) => {
  const ctx = await fixture(t);
  await writeFile(
    ctx.activePackFile,
    JSON.stringify({ version: "2026.10.21.1", contentHash: "a".repeat(64) }),
    "utf8",
  );
  await assert.rejects(
    publishMemoryPack(ctx, {
      sourceDir: path.join(ctx.reviewsDir, "missing"),
      version: "2026.10.28.1",
      approvedBy: "admin",
    }),
  );
  assert.deepEqual(JSON.parse(await readFile(ctx.activePackFile, "utf8")), {
    version: "2026.10.21.1",
    contentHash: "a".repeat(64),
  });
});
