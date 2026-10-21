import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, open, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

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
const FEEDBACK_DIRS = [
  "inbox",
  "normalized",
  "clusters",
  "conflicts",
  "reviews",
  "decisions",
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
