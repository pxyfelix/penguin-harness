/**
 * The filesystem masks every member Session adds on top of its chosen sandbox policy.
 * These paths are data, not UI copy: bwrap applies them after its read-only bind of `/`,
 * so they have to name every sibling Project, Agent and Workspace while leaving the
 * Session's own Workspace and scratchpad visible.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tenantIsolationMaskPaths } from "../src/sandbox/tenant-isolation.js";

describe("member Session isolation masks", () => {
  let base: string;
  let root: string;
  let home: string;
  let workspace: string;
  let scratchpad: string;

  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-tenant-isolation-"));
    root = path.join(base, "data");
    home = path.join(base, "home");
    workspace = path.join(
      root,
      "default_project",
      "agents",
      "default_agent",
      "workspaces",
      "user-felix",
    );
    scratchpad = path.join(
      root,
      "default_project",
      "agents",
      "default_agent",
      "scratchpad",
      "session-current",
    );
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(scratchpad, { recursive: true });
    for (const dir of [
      path.join(root, "felix-default_project"),
      path.join(root, "leader-default_project"),
      path.join(root, "machines"),
      path.join(root, "default_project", "agents", "biostat"),
      path.join(root, "default_project", "organizations"),
      path.join(root, "default_project", "agents", "default_agent", "traces"),
      path.join(root, "default_project", "agents", "default_agent", "baseline-backups"),
      path.join(root, "default_project", "agents", "default_agent", "snapshots"),
      path.join(root, "default_project", "agents", "default_agent", "workspaces", "user-teammate"),
      path.join(root, "default_project", "agents", "default_agent", "scratchpad", "session-other"),
      path.join(home, ".ssh"),
      path.join(home, "sap"),
      path.join(home, "bsplatform"),
      path.join(home, ".penguin", "node"),
      path.join(home, ".penguin", "lib"),
      path.join(home, "toolchains"),
    ]) {
      await fs.mkdir(dir, { recursive: true });
    }
    for (const file of [
      path.join(root, "web.db"),
      path.join(root, "api-token"),
      path.join(root, "default_project", ".project_config.toml"),
      path.join(root, "default_project", "agents", "default_agent", "agent_state", ".vault.toml"),
      path.join(home, ".penguin", "penguin-server-multiuser.log"),
      path.join(home, ".npmrc"),
      path.join(home, ".bash_history"),
    ]) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, "secret", "utf8");
    }
  });

  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  it("hides sibling Projects, Agents, Workspaces, scratchpads and server secrets", () => {
    const masks = tenantIsolationMaskPaths({
      dataRoot: root,
      homeDir: home,
      projectId: "default_project",
      agentId: "default_agent",
      workspace,
      scratchpad,
    });

    expect(masks).toEqual(
      expect.arrayContaining([
        path.join(root, "felix-default_project"),
        path.join(root, "leader-default_project"),
        path.join(root, "machines"),
        path.join(root, "web.db"),
        path.join(root, "api-token"),
        path.join(root, "default_project", "agents", "biostat"),
        path.join(root, "default_project", "organizations"),
        path.join(root, "default_project", ".project_config.toml"),
        path.join(root, "default_project", "agents", "default_agent", "traces"),
        path.join(root, "default_project", "agents", "default_agent", "baseline-backups"),
        path.join(root, "default_project", "agents", "default_agent", "snapshots"),
        path.join(
          root,
          "default_project",
          "agents",
          "default_agent",
          "workspaces",
          "user-teammate",
        ),
        path.join(
          root,
          "default_project",
          "agents",
          "default_agent",
          "scratchpad",
          "session-other",
        ),
        path.join(root, "default_project", "agents", "default_agent", "agent_state", ".vault.toml"),
        path.join(home, ".ssh"),
        path.join(home, "sap"),
        path.join(home, "bsplatform"),
        path.join(home, ".npmrc"),
        path.join(home, ".bash_history"),
        path.join(home, ".penguin", "penguin-server-multiuser.log"),
      ]),
    );
    expect(masks).not.toContain(workspace);
    expect(masks).not.toContain(scratchpad);
    expect(masks).not.toContain(path.join(root, "default_project"));
    expect(masks).not.toContain(path.join(root, "default_project", "agents", "default_agent"));
    expect(masks).not.toContain(path.join(home, "toolchains"));
    expect(new Set(masks).size).toBe(masks.length);
  });
});
