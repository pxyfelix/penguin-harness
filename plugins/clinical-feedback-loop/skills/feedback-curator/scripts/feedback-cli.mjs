#!/usr/bin/env node
import { access, cp, copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCsv } from "./lib/csv.mjs";
import {
  buildReviewPacket,
  captureIssue,
  exportIssues,
  importCsv,
  importExcel,
  initStore,
  listIssues,
  publishMemoryPack,
  resolveContext,
  syncStagedFeedback,
} from "./lib/store.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, "..");

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === "json") {
      options.json = true;
      continue;
    }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    options[key] = value;
    i += 1;
  }
  return { command, options };
}

function contextFrom(options) {
  return resolveContext(
    {
      root: options.root,
      project: options.project,
      store: options.store,
    },
    process.env,
  );
}

async function readInput(file) {
  return file === "-" || file === undefined ? readFile(0, "utf8") : readFile(file, "utf8");
}

async function identifyUser(env = process.env) {
  if (env.PENGUIN_USER_ID) return env.PENGUIN_USER_ID;
  if (!env.PENGUIN_API_URL || !env.PENGUIN_API_TOKEN) return undefined;
  const response = await fetch(`${env.PENGUIN_API_URL.replace(/\/$/, "")}/api/me`, {
    headers: { Authorization: `Bearer ${env.PENGUIN_API_TOKEN}` },
  });
  if (!response.ok) return undefined;
  const value = await response.json();
  return value?.user?.userId ?? value?.userId;
}

async function copyIfDifferent(source, target) {
  if (path.resolve(source) === path.resolve(target)) return;
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
}

async function copyTreeIfDifferent(source, target) {
  if (path.resolve(source) === path.resolve(target)) return;
  await cp(source, target, { recursive: true, force: true });
}

async function firstExistingDirectory(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next installed layout.
    }
  }
  throw new Error(`Required plugin directory not found: ${candidates.join(" or ")}`);
}

async function init(ctx) {
  await initStore(ctx);
  const templates = await firstExistingDirectory([
    path.join(scriptDir, "templates"),
    path.join(skillRoot, "templates"),
  ]);
  const schemas = await firstExistingDirectory([
    path.join(scriptDir, "schemas"),
    path.join(skillRoot, "schemas"),
  ]);
  await copyIfDifferent(
    path.join(scriptDir, "feedback-cli.mjs"),
    path.join(ctx.toolsDir, "feedback-cli.mjs"),
  );
  await copyTreeIfDifferent(path.join(scriptDir, "lib"), path.join(ctx.toolsDir, "lib"));
  await copyTreeIfDifferent(templates, path.join(ctx.toolsDir, "templates"));
  await copyTreeIfDifferent(schemas, path.join(ctx.toolsDir, "schemas"));
  return { ok: true, initialized: true };
}

async function capture(ctx, options, env = process.env) {
  const input = JSON.parse(await readInput(options.input));
  input.agent_id ??= env.PENGUIN_AGENT_ID;
  input.session_id ??= env.PENGUIN_SESSION_ID;
  input.user_id ??= await identifyUser(env);
  const result = await captureIssue(ctx, input);
  return {
    ok: true,
    created: result.created,
    id: result.id,
    file: result.file,
  };
}

async function list(ctx, options) {
  const result = await listIssues(ctx, { userId: options["user-id"] });
  return {
    reports: result.reports,
    invalid: result.invalid,
  };
}

async function importCsvCommand(ctx, options) {
  const rows = parseCsv(await readFile(options.input, "utf8"));
  return importCsv(ctx, rows, {
    userId: options["user-id"],
    testRound: options["test-round"],
  });
}

async function importExcelCommand(ctx, options) {
  return importExcel(ctx, options.input, {
    userId: options["user-id"],
    testRound: options["test-round"],
  });
}

async function syncStagedCommand(ctx, options) {
  const projectDir =
    options["project-dir"] ??
    path.join(process.env.PENGUIN_HOME ?? "", process.env.PENGUIN_PROJECT_ID ?? "");
  return syncStagedFeedback(ctx, { projectDir });
}

async function review(ctx, options) {
  const packet = await buildReviewPacket(ctx, {
    from: options.from,
    to: options.to,
    outDir: options.out,
  });
  const outDir = options.out ?? path.join(ctx.reviewsDir, `${options.from}_${options.to}`);
  return { ...packet, outDir };
}

async function exportCommand(ctx, options) {
  return exportIssues(ctx, {
    output: options.output,
    from: options.from,
    to: options.to,
    userId: options["user-id"],
  });
}

async function active(ctx) {
  try {
    return {
      active: JSON.parse(await readFile(ctx.activePackFile, "utf8")),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { active: null };
    throw error;
  }
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const ctx = contextFrom(options);
  let result;
  switch (command) {
    case "init":
      result = await init(ctx);
      break;
    case "capture":
      result = await capture(ctx, options);
      break;
    case "list":
      result = await list(ctx, options);
      break;
    case "import-csv":
      result = await importCsvCommand(ctx, options);
      break;
    case "import-excel":
      result = await importExcelCommand(ctx, options);
      break;
    case "sync-staged":
      result = await syncStagedCommand(ctx, options);
      break;
    case "review":
      result = await review(ctx, options);
      break;
    case "export":
      result = await exportCommand(ctx, options);
      break;
    case "publish":
      result = await publishMemoryPack(ctx, {
        sourceDir: options.source,
        version: options.version,
        approvedBy: options["approved-by"],
      });
      break;
    case "active":
      result = await active(ctx);
      break;
    default:
      throw new Error(
        "Usage: feedback-cli.mjs <init|capture|list|import-csv|import-excel|sync-staged|review|export|publish|active> [options]",
      );
  }
  process.stdout.write(`${JSON.stringify(result, null, options.json ? 0 : 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`,
  );
  process.exitCode = 1;
});
