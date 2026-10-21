import assert from "node:assert/strict";
import test from "node:test";

import { parseCsv, toCsv } from "../skills/feedback-curator/scripts/lib/csv.mjs";

test("parses commas, escaped quotes and CRLF", () => {
  assert.deepEqual(parseCsv('a,"b,c",d\r\n"x""y",z,\r\n'), [
    ["a", "b,c", "d"],
    ['x"y', "z", ""],
  ]);
});

test("round-trips cells that need quoting", () => {
  const rows = [
    ["ID", "Actual problem", "Expected result"],
    ["P01-001", 'A comma, a "quote"', "line one\nline two"],
  ];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});
