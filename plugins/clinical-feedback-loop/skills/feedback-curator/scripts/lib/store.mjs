import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { parseCsv } from "./csv.mjs";

const execFileAsync = promisify(execFile);

const SEGMENT = /^[A-Za-z0-9_-]+$/;
const SEVERITIES = new Set(["blocker", "high", "normal", "low"]);
const CAPABILITIES = new Map([
  ["crf review", "crf-review"],
  ["crf-review", "crf-review"],
  ["sap", "sap-authoring"],
  ["sap-authoring", "sap-authoring"],
  ["table shell", "tfl-shell-authoring"],
  ["tfl-shell-authoring", "tfl-shell-authoring"],
  ["workflow", "workflow"],
  ["other", "other"],
]);
const SEVERITY_LABELS = new Map([
  ["blocker", "blocker"],
  ["high", "high"],
  ["normal", "normal"],
  ["low", "low"],
  ["阻断", "blocker"],
  ["高", "high"],
  ["一般", "normal"],
  ["低", "low"],
]);
const CSV_HEADERS = {
  id: new Set(["id", "编号"]),
  capability: new Set(["capability", "能力"]),
  observed: new Set(["actual problem", "实际问题"]),
  expected: new Set(["expected result", "期望结果"]),
  severity: new Set(["severity", "严重度"]),
  evidence: new Set(["evidence", "证据"]),
};
const FEEDBACK_DIRS = [
  "inbox",
  "normalized",
  "clusters",
  "conflicts",
  "reviews",
  "decisions",
  "imports",
  "memory-packs",
  "quarantine",
  "tools",
];

function segment(value, label) {
  if (typeof value !== "string" || !SEGMENT.test(value)) {
    throw new Error(`${label} must match ${SEGMENT}.`);
  }
  return value;
}

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function normalizeCapability(value) {
  const key = requiredText(value, "capability").toLowerCase();
  const capability = CAPABILITIES.get(key);
  if (!capability) throw new Error(`Unsupported capability: ${value}`);
  return capability;
}

function normalizeSeverity(value) {
  const severity = requiredText(value, "severity").toLowerCase();
  if (!SEVERITIES.has(severity)) throw new Error(`Unsupported severity: ${value}`);
  return severity;
}

function normalizeEvidence(value) {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return [{ reference: value.trim() }].filter((e) => e.reference);
  if (!Array.isArray(value)) throw new Error("evidence must be an array or string.");
  return value.map((item) => {
    if (typeof item === "string") return { reference: item };
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("evidence entries must be strings or objects.");
    }
    return item;
  });
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function resolveContext(options = {}, env = process.env) {
  const root = options.root ?? env.PENGUIN_HOME;
  const project = options.project ?? env.PENGUIN_PROJECT_ID;
  if (!root) throw new Error("root is required (or set PENGUIN_HOME).");
  if (!project) throw new Error("project is required (or set PENGUIN_PROJECT_ID).");
  segment(project, "project");
  const projectDir = path.resolve(root, project);
  const feedbackDir = path.join(projectDir, "feedback");
  return {
    root: path.resolve(root),
    project,
    projectDir,
    feedbackDir,
    inboxDir: path.join(feedbackDir, "inbox"),
    normalizedDir: path.join(feedbackDir, "normalized"),
    clustersDir: path.join(feedbackDir, "clusters"),
    conflictsDir: path.join(feedbackDir, "conflicts"),
    reviewsDir: path.join(feedbackDir, "reviews"),
    decisionsDir: path.join(feedbackDir, "decisions"),
    memoryPacksDir: path.join(feedbackDir, "memory-packs"),
    quarantineDir: path.join(feedbackDir, "quarantine"),
    toolsDir: path.join(feedbackDir, "tools"),
    activePackFile: path.join(feedbackDir, "active-memory-pack.json"),
  };
}

export async function initStore(ctx) {
  for (const dir of FEEDBACK_DIRS) {
    await mkdir(path.join(ctx.feedbackDir, dir), { recursive: true });
  }
  const readme = path.join(ctx.feedbackDir, "README.md");
  try {
    await access(readme, constants.F_OK);
  } catch {
    await writeFile(
      readme,
      [
        "# Clinical feedback store",
        "",
        "- Raw reports live in `inbox/<user>/<date>/`.",
        "- Clusters and conflicts are reviewed artifacts.",
        "- Approved knowledge lives in versioned `memory-packs/`.",
        "- Agents never write Memory Packs directly.",
        "",
      ].join("\n"),
      { flag: "wx" },
    );
  }
}

export function normalizeIssue(input, now = new Date()) {
  const source = requiredText(input.source ?? "agent_capture", "source");
  const report = {
    id: input.id,
    created_at: input.created_at ?? now.toISOString(),
    source,
    project_id: input.project_id,
    agent_id: input.agent_id,
    capability: normalizeCapability(input.capability),
    user_id: segment(requiredText(input.user_id, "user_id"), "user_id"),
    session_id: input.session_id,
    trace_path: input.trace_path ?? null,
    workspace: input.workspace ?? null,
    case_id: input.case_id ?? null,
    observed: requiredText(input.observed, "observed"),
    expected: requiredText(input.expected ?? "Not stated by the reporter.", "expected"),
    category: input.category ?? "other",
    severity: normalizeSeverity(input.severity),
    evidence: normalizeEvidence(input.evidence),
    root_cause_hint: Array.isArray(input.root_cause_hint) ? input.root_cause_hint : [],
    status: input.status ?? "new",
    sensitivity: input.sensitivity ?? "internal",
    test_round: input.test_round ?? null,
  };
  if (report.agent_id !== undefined && report.agent_id !== null) {
    segment(report.agent_id, "agent_id");
  }
  if (report.session_id !== undefined && report.session_id !== null) {
    segment(report.session_id, "session_id");
  }
  if (source === "agent_capture" && (!report.agent_id || !report.session_id)) {
    throw new Error("agent_capture requires agent_id and session_id.");
  }
  const fingerprint = createHash("sha256")
    .update(
      stableJson({
        source: report.source,
        user_id: report.user_id,
        agent_id: report.agent_id ?? null,
        session_id: report.session_id ?? null,
        capability: report.capability,
        observed: report.observed,
        expected: report.expected,
      }),
    )
    .digest("hex");
  const date = report.created_at.slice(0, 10).replaceAll("-", "");
  report.fingerprint = fingerprint;
  report.id = input.id ? segment(input.id, "id") : `FB-${date}-${fingerprint.slice(0, 10)}`;
  return report;
}

export async function writeJsonExclusive(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const handle = await open(file, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  } finally {
    await handle.close();
  }
}

export async function captureIssue(ctx, input, now = new Date()) {
  const report = normalizeIssue({ ...input, project_id: ctx.project }, now);
  const day = report.created_at.slice(0, 10);
  const file = path.join(ctx.inboxDir, report.user_id, day, `${report.id}.json`);
  try {
    await writeJsonExclusive(file, report);
    return { created: true, id: report.id, file, report };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = JSON.parse(await readFile(file, "utf8"));
    if (existing.fingerprint !== report.fingerprint) {
      throw new Error(`Feedback id already exists with different content: ${report.id}`);
    }
    return { created: false, id: report.id, file, report: existing };
  }
}

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function findHeaderMap(headerRow) {
  const normalized = headerRow.map(normalizeHeader);
  const indexes = {};
  for (const [field, aliases] of Object.entries(CSV_HEADERS)) {
    const index = normalized.findIndex((value) => aliases.has(value));
    if (index >= 0) indexes[field] = index;
  }
  if (Object.keys(indexes).length !== Object.keys(CSV_HEADERS).length) {
    throw new Error(
      "Excel headers must include ID, Capability, Actual problem, Expected result, Severity and Evidence.",
    );
  }
  return indexes;
}

function csvCell(row, index) {
  return String(row[index] ?? "").trim();
}

export async function importCsv(ctx, rows, options, now = new Date()) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("CSV rows must be a non-empty array.");
  }
  const headers = findHeaderMap(rows[0]);
  const userId = segment(requiredText(options.userId, "userId"), "userId");
  let imported = 0;
  let duplicate = 0;
  let invalid = 0;
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row.some((value) => String(value ?? "").trim() !== "")) continue;
    const observed = csvCell(row, headers.observed);
    if (!observed) {
      invalid += 1;
      continue;
    }
    const expected = csvCell(row, headers.expected) || "Not stated by the reporter.";
    const severityLabel = csvCell(row, headers.severity).toLowerCase();
    const severity = SEVERITY_LABELS.get(severityLabel);
    if (!severity) {
      invalid += 1;
      continue;
    }
    const capability = csvCell(row, headers.capability);
    if (!capability) {
      invalid += 1;
      continue;
    }
    const evidence = makeEvidenceReference(csvCell(row, headers.evidence));
    let id = csvCell(row, headers.id);
    if (!id) {
      const digest = createHash("sha256")
        .update(
          stableJson({
            user_id: userId,
            test_round: options.testRound ?? null,
            capability,
            observed,
            expected,
            severity,
            evidence,
          }),
        )
        .digest("hex");
      id = `FB-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${digest.slice(0, 10)}`;
    }
    try {
      const result = await captureIssue(
        ctx,
        {
          id,
          source: "excel",
          user_id: userId,
          capability,
          observed,
          expected,
          severity,
          evidence: evidence ? [evidence] : [],
          category: "imported",
          test_round: options.testRound ?? null,
        },
        now,
      );
      if (result.created) imported += 1;
      else duplicate += 1;
    } catch {
      invalid += 1;
    }
  }
  return { imported, duplicate, invalid };
}

export async function convertXlsxToCsv(file, tempDir) {
  const absolute = path.resolve(file);
  await execFileAsync("libreoffice", [
    "--headless",
    "--convert-to",
    "csv",
    "--outdir",
    tempDir,
    absolute,
  ]);
  return path.join(tempDir, `${path.basename(absolute, path.extname(absolute))}.csv`);
}

export async function importExcel(ctx, file, options, deps = {}, now = new Date()) {
  const convert = deps.convert ?? convertXlsxToCsv;
  const tempDir = await mkdtemp(path.join(tmpdir(), "clinical-excel-"));
  try {
    const csvFile = await convert(file, tempDir);
    return await importCsv(ctx, parseCsv(await readFile(csvFile, "utf8")), options, now);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function scanJsonDir(dir, validate) {
  const valid = [];
  const invalid = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { valid, invalid };
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = path.join(dir, entry.name);
    try {
      const value = JSON.parse(await readFile(file, "utf8"));
      validate(value);
      valid.push({ ...value, file });
    } catch {
      invalid.push(file);
    }
  }
  valid.sort((a, b) => a.id.localeCompare(b.id));
  return { valid, invalid };
}

function validateCluster(value) {
  requiredText(value?.id, "cluster.id");
  requiredText(value?.title, "cluster.title");
  requiredText(value?.capability, "cluster.capability");
  if (!Array.isArray(value?.report_ids) || value.report_ids.length === 0) {
    throw new Error("cluster.report_ids is required.");
  }
  requiredText(value?.status, "cluster.status");
}

function validateConflict(value) {
  requiredText(value?.id, "conflict.id");
  requiredText(value?.title, "conflict.title");
  if (!Array.isArray(value?.claims) || value.claims.length < 2) {
    throw new Error("conflict.claims needs at least two claims.");
  }
  requiredText(value?.status, "conflict.status");
}

export async function buildReviewPacket(ctx, options, now = new Date()) {
  const from = requiredText(options.from, "from");
  const to = requiredText(options.to, "to");
  const outDir = options.outDir ?? path.join(ctx.reviewsDir, `${from}_${to}`);
  const { reports: allReports, invalid: invalidReports } = await listIssues(ctx);
  const reports = allReports
    .filter((report) => report.source !== "rsi_eval")
    .filter((report) => {
      const day = String(report.created_at ?? "").slice(0, 10);
      return day >= from && day <= to;
    })
    .map(({ file, ...report }) => ({ ...report, file }));
  const clusters = await scanJsonDir(ctx.clustersDir, validateCluster);
  const conflicts = await scanJsonDir(ctx.conflictsDir, validateConflict);
  const byCapability = {};
  for (const report of reports) {
    byCapability[report.capability] = (byCapability[report.capability] ?? 0) + 1;
  }
  const packet = {
    from,
    to,
    generatedAt: now.toISOString(),
    reportCount: reports.length,
    byCapability,
    reports,
    invalidReports,
    clusters: clusters.valid,
    invalidClusters: clusters.invalid,
    conflicts: conflicts.valid,
    invalidConflicts: conflicts.invalid,
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, "reports.jsonl"),
    reports.map((report) => JSON.stringify(report)).join("\n") + (reports.length > 0 ? "\n" : ""),
    "utf8",
  );
  await writeFile(path.join(outDir, "packet.json"), `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  const lines = [
    `# Feedback review ${from}..${to}`,
    "",
    `- Reports: ${reports.length}`,
    `- Invalid reports: ${invalidReports.length}`,
    `- Clusters: ${clusters.valid.length}`,
    `- Invalid clusters: ${clusters.invalid.length}`,
    `- Conflicts: ${conflicts.valid.length}`,
    `- Invalid conflicts: ${conflicts.invalid.length}`,
    "",
    "## Reports by capability",
    "",
    ...Object.entries(byCapability)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([capability, count]) => `- ${capability}: ${count}`),
    "",
    "## Reports",
    "",
    ...reports.map(
      (report) =>
        `- \`${report.id}\` [${report.severity}] ${report.capability}: ${report.observed}`,
    ),
    "",
  ];
  await writeFile(path.join(outDir, "packet.md"), lines.join("\n"), "utf8");
  return packet;
}

async function listRelativeFiles(dir, prefix = "") {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listRelativeFiles(path.join(dir, entry.name), relative)));
    } else if (
      entry.isFile() &&
      (relative === "MEMORY.md" ||
        relative === "changelog.md" ||
        /^entries\/.+\.md$/.test(relative))
    ) {
      files.push(relative);
    }
  }
  return files;
}

async function packContentHash(dir) {
  const hash = createHash("sha256");
  for (const relative of await listRelativeFiles(dir)) {
    hash.update(relative);
    hash.update("\0");
    hash.update(await readFile(path.join(dir, relative)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function validateMemoryManifest(manifest) {
  if (!/^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[0-9]+$/.test(manifest?.version ?? "")) {
    throw new Error("manifest.version must be YYYY.MM.DD.N.");
  }
  requiredText(manifest?.approvedBy, "manifest.approvedBy");
  requiredText(manifest?.approvedAt, "manifest.approvedAt");
  if (!Array.isArray(manifest?.entries)) throw new Error("manifest.entries must be an array.");
}

async function replaceActivePointer(ctx, pointer) {
  const temp = `${ctx.activePackFile}.tmp-${process.pid}-${randomSuffix()}`;
  await writeFile(temp, `${JSON.stringify(pointer, null, 2)}\n`, "utf8");
  try {
    await rename(temp, ctx.activePackFile);
  } catch (error) {
    if (error?.code !== "EEXIST" && error?.code !== "EPERM") throw error;
    await rm(ctx.activePackFile, { force: true });
    await rename(temp, ctx.activePackFile);
  }
}

export async function publishMemoryPack(ctx, options, now = new Date()) {
  const approvedBy = requiredText(options.approvedBy, "approvedBy");
  const version = requiredText(options.version, "version");
  if (!/^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[0-9]+$/.test(version)) {
    throw new Error("version must be YYYY.MM.DD.N.");
  }
  const sourceDir = path.resolve(options.sourceDir);
  const manifestFile = path.join(sourceDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  validateMemoryManifest({ ...manifest, version, approvedBy });
  await access(path.join(sourceDir, "MEMORY.md"), constants.R_OK);
  await access(path.join(sourceDir, "changelog.md"), constants.R_OK);
  await access(path.join(sourceDir, "entries"), constants.R_OK);
  const target = path.join(ctx.memoryPacksDir, version);
  try {
    await access(target, constants.F_OK);
    throw new Error(`Memory Pack already exists: ${version}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const staging = path.join(
    ctx.memoryPacksDir,
    `.staging-${version}-${process.pid}-${randomSuffix()}`,
  );
  await cp(sourceDir, staging, { recursive: true });
  try {
    const contentHash = await packContentHash(staging);
    const finalManifest = {
      ...manifest,
      version,
      approvedBy,
      approvedAt: manifest.approvedAt ?? now.toISOString(),
      contentHash,
    };
    await writeFile(
      path.join(staging, "manifest.json"),
      `${JSON.stringify(finalManifest, null, 2)}\n`,
      "utf8",
    );
    await rename(staging, target);
    await replaceActivePointer(ctx, {
      version,
      path: path.relative(ctx.feedbackDir, target),
      contentHash,
      activatedAt: now.toISOString(),
    });
    return { version, dir: target, contentHash, manifest: finalManifest };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function listIssues(ctx, options = {}) {
  const reports = [];
  const invalid = [];
  const root = path.join(ctx.inboxDir, options.userId ?? "");
  let entries = [];
  try {
    entries = await readdir(root, { recursive: true, withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { reports, invalid };
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = path.join(entry.parentPath, entry.name);
    try {
      const report = JSON.parse(await readFile(file, "utf8"));
      reports.push({ ...report, file });
    } catch {
      invalid.push(file);
    }
  }
  reports.sort((a, b) =>
    a.created_at === b.created_at
      ? a.id.localeCompare(b.id)
      : a.created_at.localeCompare(b.created_at),
  );
  return { reports, invalid };
}

export function makeEvidenceReference(value) {
  const text = String(value ?? "").trim();
  return text ? { reference: text } : null;
}

export function randomSuffix() {
  return randomBytes(3).toString("hex");
}
