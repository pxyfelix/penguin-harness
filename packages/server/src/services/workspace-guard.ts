/**
 * Workspace validation.
 *
 * When a user explicitly specifies a Workspace: after realpath normalization
 * (resolving `..` and symlinks), it's required to be an **existing directory**
 * (never auto-created). The directory location is not constrained to the
 * Project directory — a Workspace can be any path on the server, with actual
 * reachability governed by the file permissions of the OS account running the
 * service.
 * When no Workspace is specified, this module isn't involved (the SDK creates its
 * own temporary workspace).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../http/errors.js";

/** Whether `target` is `root` itself or a descendant of it. */
export function isWithinPath(target: string, root: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** The stable private Workspace a Project member gets when none is named. */
export async function ensureUserWorkspace(args: {
  root: string;
  projectId: string;
  agentId: string;
  userId: string;
}): Promise<string> {
  const base = path.join(args.root, args.projectId, "agents", args.agentId, "workspaces");
  const target = path.join(base, `user-${args.userId}`);
  await fs.mkdir(base, { recursive: true });
  const existing = await fs.lstat(target).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  if (existing?.isSymbolicLink()) {
    throw new HttpError(
      403,
      "workspace_forbidden",
      "The private Workspace path is not a real directory.",
    );
  }
  if (existing === null) await fs.mkdir(target);
  else if (!existing.isDirectory()) {
    throw new HttpError(
      403,
      "workspace_forbidden",
      "The private Workspace path is not a directory.",
    );
  }
  const [realBase, realTarget] = await Promise.all([fs.realpath(base), fs.realpath(target)]);
  if (!isWithinPath(realTarget, realBase)) {
    throw new HttpError(
      403,
      "workspace_forbidden",
      "The private Workspace resolves outside the Agent workspace directory.",
    );
  }
  return realTarget;
}

/** A member may only name its own private Workspace (or a directory inside it). */
export async function assertWorkspaceWithin(args: {
  workspace: string;
  root: string;
}): Promise<string> {
  const [workspace, root] = await Promise.all([
    fs.realpath(args.workspace),
    fs.realpath(args.root),
  ]);
  if (!isWithinPath(workspace, root)) {
    throw new HttpError(
      403,
      "workspace_forbidden",
      "Members may only use their own private Workspace.",
    );
  }
  return workspace;
}

/**
 * Validates and returns the normalized (realpath) Workspace path.
 *
 * @throws 400 workspace_not_found: the path doesn't exist, isn't readable, or isn't a directory.
 */
export async function assertWorkspaceAllowed(args: { workspace: string }): Promise<string> {
  let ws: string;
  try {
    ws = await fs.realpath(args.workspace);
  } catch {
    throw new HttpError(
      400,
      "workspace_not_found",
      `Workspace does not exist or is inaccessible: ${args.workspace}. Specify an existing directory, or leave it empty to use a temporary workspace.`,
    );
  }
  const stat = await fs.stat(ws);
  if (!stat.isDirectory()) {
    throw new HttpError(
      400,
      "workspace_not_found",
      `Workspace is not a directory: ${args.workspace}.`,
    );
  }
  return ws;
}
