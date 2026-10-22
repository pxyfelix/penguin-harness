/**
 * Mandatory read masks for one member Session.
 *
 * The selectable sandbox policy is about WRITE access. A shared server also needs a read
 * boundary: a member may use the Project's Agent without reading another Project's files,
 * another member's Workspace / scratchpad / Trace, or server credentials. These masks are
 * added at every confined spawn, including a Session whose stored policy says full access,
 * so turning the sandbox switch off cannot expose a colleague's data.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface TenantIsolationPaths {
  dataRoot: string;
  homeDir?: string;
  projectId: string;
  agentId: string;
  workspace: string;
  scratchpad?: string;
}

const KEEP_HOME = new Set([
  ".penguin",
  ".local",
  ".cache",
  ".npm",
  "toolchains",
  ".bashrc",
  ".profile",
  ".zshrc",
  ".sudo_as_admin_successful",
]);

const KEEP_PENGUIN = new Set(["bin", "lib", "node", "web", "data"]);

function entries(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function add(set: Set<string>, target: string): void {
  set.add(path.resolve(target));
}

function addSiblingsExcept(set: Set<string>, parent: string, keep: readonly string[]): void {
  const kept = new Set(keep.map((target) => path.resolve(target)));
  for (const entry of entries(parent)) {
    const target = path.join(parent, entry.name);
    if (!kept.has(path.resolve(target))) add(set, target);
  }
}

/** Every filesystem path a member Session must not read, deduplicated and absolute. */
export function tenantIsolationMaskPaths(args: TenantIsolationPaths): string[] {
  const dataRoot = path.resolve(args.dataRoot);
  const homeDir = path.resolve(args.homeDir ?? os.homedir());
  const projectDir = path.join(dataRoot, args.projectId);
  const agentsDir = path.join(projectDir, "agents");
  const agentDir = path.join(agentsDir, args.agentId);
  const workspace = path.resolve(args.workspace);
  const scratchpad = args.scratchpad === undefined ? null : path.resolve(args.scratchpad);
  const masks = new Set<string>();
  const workspaceParts = path.relative(agentsDir, workspace).split(path.sep);
  const workspaceAgentId =
    workspaceParts.length >= 3 &&
    workspaceParts[0] !== "" &&
    workspaceParts[0] !== "." &&
    workspaceParts[0] !== ".." &&
    workspaceParts[1] === "workspaces"
      ? workspaceParts[0]!
      : null;
  const workspaceAgentDir =
    workspaceAgentId === null ? null : path.join(agentsDir, workspaceAgentId);

  // Another Project, machine state, the SQLite index/token, and every other server-level
  // entry in the data root. `bin` is the CLI shim every Agent command may invoke.
  addSiblingsExcept(masks, dataRoot, [projectDir, path.join(dataRoot, "bin")]);

  // Another Agent in this Project, plus Project-wide state that no ordinary chat needs
  // through a shell. A subagent may use its own Agent state and a Workspace owned by an
  // ancestor Agent, so both directories remain reachable. The Project config carries model
  // credentials.
  addSiblingsExcept(masks, agentsDir, [
    agentDir,
    ...(workspaceAgentDir === null ? [] : [workspaceAgentDir]),
  ]);
  add(masks, path.join(projectDir, ".project_config.toml"));
  add(masks, path.join(projectDir, "organizations"));

  // Raw history and saved states are read through the owner-filtered HTTP API, not by a
  // command reading the server's storage directly.
  add(masks, path.join(agentDir, "traces"));
  add(masks, path.join(agentDir, "baseline-backups"));
  add(masks, path.join(agentDir, "snapshots"));
  add(masks, path.join(agentDir, "agent_state", ".vault.toml"));

  // The Workspace owner is typically the root Agent while the command belongs to a nested
  // child, which has its own Agent state. Keep only that Agent's Workspaces subtree, then
  // only the shared Workspace inside it.
  if (workspaceAgentDir !== null && path.resolve(workspaceAgentDir) !== path.resolve(agentDir)) {
    const workspaceOwnerWorkspaces = path.join(workspaceAgentDir, "workspaces");
    addSiblingsExcept(masks, workspaceAgentDir, [workspaceOwnerWorkspaces]);
    addSiblingsExcept(masks, workspaceOwnerWorkspaces, [workspace]);
  }

  // Workspaces and scratchpads are per Session/person, not Project-shared directories.
  addSiblingsExcept(masks, path.join(agentDir, "workspaces"), [workspace]);
  addSiblingsExcept(
    masks,
    path.join(agentDir, "scratchpad"),
    scratchpad === null ? [] : [scratchpad],
  );

  // Hide the deployment's unrelated applications, credentials and shell history. The PH
  // install itself and toolchains stay visible so the Agent can run its own CLI/tools.
  for (const entry of entries(homeDir)) {
    if (!KEEP_HOME.has(entry.name)) add(masks, path.join(homeDir, entry.name));
  }
  for (const entry of entries(path.join(homeDir, ".penguin"))) {
    const target = path.join(homeDir, ".penguin", entry.name);
    // Deployments may name their data root something other than "data". Keep that exact
    // root visible; its Project/Agent/Workspace siblings are masked above.
    if (path.resolve(target) === dataRoot) continue;
    if (!KEEP_PENGUIN.has(entry.name)) add(masks, target);
  }

  return [...masks].sort();
}
