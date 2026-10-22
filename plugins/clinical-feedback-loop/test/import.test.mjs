import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { parseCsv } from "../skills/feedback-curator/scripts/lib/csv.mjs";
import {
  importCsv,
  importExcel,
  initStore,
  listIssues,
  resolveContext,
} from "../skills/feedback-curator/scripts/lib/store.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "clinical-import-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ctx = resolveContext({ root, project: "pilot" }, {});
  await initStore(ctx);
  return ctx;
}

const csv = `ID,Capability,Actual problem,Expected result,Severity,Evidence
P02-004,Table Shell,主要终点表没有分析人群,明确 ITT 和 Week 12,High,P02-SHELL-R1
`;

test("imports a six-column Excel export", async (t) => {
  const ctx = await fixture(t);
  const result = await importCsv(ctx, parseCsv(csv), {
    userId: "poppy",
    testRound: "P02",
  });
  assert.deepEqual(result, { imported: 1, duplicate: 0, invalid: 0 });
  const listing = await listIssues(ctx);
  assert.equal(listing.reports.length, 1);
  const report = listing.reports[0];
  assert.equal(report.id, "P02-004");
  assert.equal(report.source, "excel");
  assert.equal(report.capability, "tfl-shell-authoring");
  assert.equal(report.severity, "high");
  assert.deepEqual(report.evidence, [{ reference: "P02-SHELL-R1" }]);
  assert.equal(report.test_round, "P02");
});

test("imports the last row after a guide and example above the headers", async (t) => {
  const ctx = await fixture(t);
  const templateCsv = `填写说明：第 2 行为示例，请从第 4 行开始填写。
P02-004,Table Shell,示例问题,示例期望,High,示例证据
编号,能力,实际问题,期望结果,严重度,证据
P02-005,CRF Review,主要终点缺少缺失值处理说明,明确缺失值处理规则,Blocker,P02-CRF-R2
`;
  const result = await importCsv(ctx, parseCsv(templateCsv), {
    userId: "poppy",
    testRound: "P02",
  });
  assert.deepEqual(result, { imported: 1, duplicate: 0, invalid: 0 });
  const listing = await listIssues(ctx);
  assert.equal(listing.reports.length, 1);
  assert.equal(listing.reports[0].id, "P02-005");
  assert.equal(listing.reports[0].observed, "主要终点缺少缺失值处理说明");
});

test("re-importing the same workbook rows is idempotent", async (t) => {
  const ctx = await fixture(t);
  const rows = parseCsv(csv);
  await importCsv(ctx, rows, { userId: "poppy", testRound: "P02" });
  const second = await importCsv(ctx, rows, { userId: "poppy", testRound: "P02" });
  assert.deepEqual(second, { imported: 0, duplicate: 1, invalid: 0 });
  assert.equal((await listIssues(ctx)).reports.length, 1);
});

test("rejects a workbook with the wrong columns", async (t) => {
  const ctx = await fixture(t);
  await assert.rejects(
    importCsv(ctx, [["Problem"], ["Missing data"]], { userId: "poppy" }),
    /headers/,
  );
});

test("imports an xlsx by converting it to CSV first", async (t) => {
  const ctx = await fixture(t);
  const result = await importExcel(
    ctx,
    path.join(ctx.projectDir, "feedback.xlsx"),
    { userId: "poppy", testRound: "P02" },
    {
      convert: async (_workbook, tempDir) => {
        const converted = path.join(tempDir, "feedback.csv");
        await writeFile(converted, csv, "utf8");
        return converted;
      },
    },
  );
  assert.deepEqual(result, { imported: 1, duplicate: 0, invalid: 0 });
});
