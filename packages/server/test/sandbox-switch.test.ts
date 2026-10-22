/**
 * The Sandbox card's switch (whether new Sessions start confined) and its default preset:
 * settings saved before either existed keep their start, a new Session starts from the default
 * preset while the switch is on and unconfined while it is off, and the card reports whether
 * this OS has a sandbox backend.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import type { SandboxPolicy, SandboxProvider } from "@prismshadow/penguin-core/plugin";
import type { PluginConfigEntry, PluginConfigResponse, SessionSandbox } from "../src/api/types.js";
import { PluginHost } from "../src/plugin/host.js";
import type { SandboxService } from "../src/sandbox/service.js";
import type { SessionEnv } from "../src/runtime/session-manager.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** What the server defaults to on this OS; Linux offers sandbox-dsh (Landlock) beside bubblewrap. */
const recommended = (
  {
    linux: ["@penguinharness/sandbox-bwrap", "@penguinharness/sandbox-dsh"],
    darwin: ["@penguinharness/sandbox-seatbelt"],
    win32: ["@penguinharness/sandbox-wsl"],
  } as Partial<Record<NodeJS.Platform, string[]>>
)[process.platform];

/** A backend plugin whose providers resolve as given: a provider, null (declined), or a failure. */
function backendPlugin(bind: Record<string, unknown>): PluginHost {
  const module: ModuleDef = {
    manifest: parseManifest({
      name: "SwitchTestBackend",
      requires: {},
      provides: {},
      contributes: {
        "SandboxModule.providers": Object.keys(bind).map((id) => ({
          id,
          name: id.replace(/\.provider$/, ""),
          dimensions: ["fs-write", "network", "mask-paths"],
        })),
      },
      children: [],
    }),
    create: () => ({ api: {}, bind }),
  };
  const host = new PluginHost();
  host.use({ specifier: "switch-test-backend", modules: [module], replaces: [] });
  return host;
}

const PROVIDER = {
  dimensions: ["fs-write", "network", "mask-paths"],
  confine: (argv: readonly string[]) => ({
    argv: ["confined", ...argv],
    enforcement: "full" as const,
    denialSignatures: [],
    runnerFailureRules: [],
  }),
};
const fakeBackend = () => backendPlugin({ "fake.provider": PROVIDER });

type Doc = Record<string, unknown>;
type View = { sandbox: SessionSandbox };
type Created = { session: { sessionId: string; approvalMode: string } & View };

const apps: TestApp[] = [];
afterEach(async () => {
  for (const t of apps.splice(0)) await t.cleanup();
});

async function boot(opts: { plugins?: PluginHost; dbPath?: string } = {}) {
  const t = await createTestApp({
    ...(opts.plugins ? { plugins: opts.plugins } : {}),
    ...(opts.dbPath ? { config: { dbPath: opts.dbPath } } : {}),
  });
  apps.push(t);
  const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  const sandbox = t.deps.tree.api<SandboxService>("SandboxModule", "sandbox");
  await sandbox.whenReady();
  const card = async (): Promise<PluginConfigEntry> =>
    (
      (await (await admin.get("/api/admin/plugin-config")).json()) as PluginConfigResponse
    ).plugins.find((e) => e.name === "sandbox")!;
  const save = (values: Doc) => admin.put("/api/admin/plugin-config", { name: "sandbox", values });
  const store = (doc: Doc) =>
    t.deps.serverSettingsRepo.set("plugin-config:sandbox", JSON.stringify(doc));
  const onDisk = () => JSON.parse(t.deps.serverSettingsRepo.get("plugin-config:sandbox")!) as Doc;
  return { t, sandbox, card, save, store, onDisk };
}

/** A member's Project with a model, and the calls a composer makes in it. */
async function ownerProject(t: TestApp, id: string) {
  const owner = apiClient(t.app, (await provisionUser(t.app, "owner")).cookie);
  const res = await owner.post("/api/projects", { projectId: id, name: "project" });
  const projectId = ((await res.json()) as { project: { projectId: string } }).project.projectId;
  const model = { provider: "anthropic", modelId: "claude-sonnet-4-6" };
  await owner.put(`/api/projects/${projectId}/models`, {
    defaultModel: model,
    models: [{ ...model, contextWindow: 128000 }],
  });
  return {
    owner,
    create: async () =>
      (await (
        await owner.post(`/api/projects/${projectId}/agents/default_agent/sessions`, {})
      ).json()) as Created,
    read: async (sessionId: string) =>
      ((await (await owner.get(`/api/sessions/${sessionId}`)).json()) as Created).session.sandbox,
    draft: async () =>
      ((await (await owner.get(`/api/projects/${projectId}/chat-defaults`)).json()) as View)
        .sandbox,
  };
}

describe("the sandbox switch", () => {
  // Settings saved before the switch read as on exactly when they confined anything.
  it.each([
    [{ mode: "read-only", network: "none" }, true, { mode: "read-only", network: "none" }],
    [
      { mode: "danger-full-access", network: "none" },
      true,
      { mode: "danger-full-access", network: "none" },
    ],
    [{ mode: "danger-full-access", maskPaths: [] }, false, { mode: "danger-full-access" }],
  ])(
    "reads pre-switch settings %j as on=%s, applies them, and leaves the disk alone",
    async (doc, on, applied) => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-sandbox-switch-"));
      try {
        const dbPath = path.join(dir, "web.db");
        const first = await boot({ plugins: fakeBackend(), dbPath });
        first.store(doc);
        await apps.pop()!.cleanup();
        const next = await boot({ plugins: fakeBackend(), dbPath });
        expect((await next.card()).values.enabled).toBe(on);
        expect(next.sandbox.currentSettings()).toEqual(applied);
        expect(next.t.deps.serverSettingsRepo.get("plugin-config:sandbox")).toBe(
          JSON.stringify(doc),
        );
      } finally {
        for (const t of apps.splice(0)) await t.cleanup();
        await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    },
  );

  it("shows the row a pre-preset document matches as the default, and none when no row matches", async () => {
    const { card, store } = await boot();
    const prePresetNotice = (entry: PluginConfigEntry) =>
      entry.notices?.find((n) => n.text.includes("saved before the presets"));
    // Nothing saved is no pre-preset document: the shipped default.
    expect((await card()).values.defaultPreset).toBe("workspace-write");

    const cut = {
      name: "Cut",
      enabled: false,
      mode: "read-only",
      network: "none",
      approvalMode: "allow-all",
    };
    // Same mode and network, approving everything; masked paths lie over every row; added rows count.
    for (const [doc, row] of [
      [{ mode: "read-only" }, "read-only"],
      [{ mode: "workspace-write", network: "open" }, "workspace-write"],
      [{ mode: "workspace-write", maskPaths: ["/secret"] }, "workspace-write"],
      [{ mode: "read-only", network: "none", presets: { $added: { cut } } }, "cut"],
    ] as const) {
      store(doc);
      const entry = await card();
      expect(entry.values.defaultPreset, JSON.stringify(doc)).toBe(row);
      expect(prePresetNotice(entry)).toBeUndefined();
    }

    // No row starts there (Off with masked paths confines nothing): no default, and a notice.
    for (const doc of [
      { mode: "workspace-write", network: "local" },
      { maskPaths: ["/secret"] },
      { mode: "danger-full-access", maskPaths: ["/secret"] },
      { mode: "read-only", network: "none" },
    ]) {
      store(doc);
      const entry = await card();
      expect(entry.values.defaultPreset, JSON.stringify(doc)).toBeUndefined();
      expect(entry.values.enabled).toBe(true);
      expect(prePresetNotice(entry), JSON.stringify(doc)).toMatchObject({ tone: "attention" });
    }
    // The notice says what is in effect (the last document's start).
    expect(prePresetNotice(await card())?.text).toContain("files Read-only, network No network");
  });

  it("keeps a pre-preset document's start across a save that picks no default", async () => {
    const { save, sandbox, store, onDisk } = await boot();
    const rename = { presets: { "read-only": { name: "Look only" } } };

    // No row matches: an unrelated save writes no default; an administrator's pick moves it.
    store({ mode: "read-only", network: "none" });
    expect((await save(rename)).status).toBe(200);
    expect(onDisk().defaultPreset).toBeUndefined();
    expect(sandbox.currentSettings()).toEqual({ mode: "read-only", network: "none" });
    expect((await save({ defaultPreset: "workspace-write" })).status).toBe(200);
    expect(onDisk().defaultPreset).toBe("workspace-write");
    expect(sandbox.currentSettings()).toEqual({ mode: "workspace-write" });

    // A row matches: the save pins it, and the start is what it was.
    store({ mode: "read-only" });
    expect((await save(rename)).status).toBe(200);
    expect(onDisk().defaultPreset).toBe("read-only");
    expect(sandbox.currentSettings()).toEqual({ mode: "read-only" });
  });

  it("on, a new Session starts from the default preset; off, unconfined; existing Sessions keep theirs", async () => {
    const { t, card, save, sandbox } = await boot({ plugins: fakeBackend() });
    // Fresh install: off.
    expect((await card()).values.enabled).toBe(false);
    const { create, read, draft } = await ownerProject(t, "owner-switch");

    const remapped = { "read-only": { network: "none", approvalMode: "always-ask" } };
    const onSave = await save({ enabled: true, defaultPreset: "read-only", presets: remapped });
    expect(onSave.status).toBe(200);
    const confined = await create();
    expect(confined.session.approvalMode).toBe("always-ask");
    const readOnly = { mode: "read-only", network: "none" };
    expect(confined.session.sandbox).toMatchObject({ ...readOnly, switchOn: true });
    expect(await draft()).toMatchObject({ ...readOnly, defaultApprovalMode: "always-ask" });

    // Another default reaches new Sessions only.
    expect((await save({ defaultPreset: "workspace-write" })).status).toBe(200);
    const next = await create();
    expect(next.session.approvalMode).toBe("allow-all");
    expect(next.session.sandbox).toMatchObject({ mode: "workspace-write", network: "open" });
    expect(await read(confined.session.sessionId)).toMatchObject(readOnly);

    // Off: unconfined, no approval mode from the presets; the default stays recorded.
    const off = await save({ enabled: false });
    const offCard = ((await off.json()) as PluginConfigResponse).plugins.find(
      (e) => e.name === "sandbox",
    )!;
    expect(offCard.values).toMatchObject({ enabled: false, defaultPreset: "workspace-write" });
    expect(sandbox.currentSettings()).toEqual({ mode: "danger-full-access" });
    const unconfined = await create();
    expect(unconfined.session.approvalMode).toBe("allow-all");
    expect(unconfined.session.sandbox).toMatchObject({
      mode: "danger-full-access",
      network: "open",
      switchOn: false,
    });
    const offDraft = await draft();
    expect(offDraft).toMatchObject({ mode: "danger-full-access", switchOn: false });
    expect(offDraft.defaultApprovalMode).toBeUndefined();
    expect(await read(confined.session.sessionId)).toMatchObject({ ...readOnly, switchOn: false });

    // On again: the default preset applies again, to new Sessions only.
    expect((await save({ enabled: true })).status).toBe(200);
    expect(sandbox.currentSettings()).toEqual({ mode: "workspace-write" });
    expect(await read(unconfined.session.sessionId)).toMatchObject({ mode: "danger-full-access" });
  });

  it("serves the card's presets to the composer in the stored order, added ones included, and a pick applies", async () => {
    const { t, save } = await boot();
    const { owner, create, draft } = await ownerProject(t, "owner-order");
    const order = ["mine", "read-only", "full-access", "always-ask", "workspace-write"];
    const mine = {
      name: "Mine",
      enabled: true,
      mode: "read-only",
      network: "open",
      approvalMode: "always-ask",
    };
    const saved = await save({
      enabled: true,
      defaultPreset: "mine",
      presets: { $added: { mine }, $order: order },
    });
    expect(saved.status).toBe(200);
    const sandbox = await draft();
    // The stored order first, then the rows it does not name, as declared.
    expect(sandbox.presets?.map((p) => p.id)).toEqual([
      ...order,
      "workspace-write-ask",
      "denied-all",
    ]);
    expect(sandbox.presets?.[0]).toMatchObject({ name: "Mine", enabled: true });
    expect(sandbox).toMatchObject({ switchOn: true, defaultApprovalMode: "always-ask" });

    const created = await create();
    expect(created.session.approvalMode).toBe("always-ask");
    expect(created.session.sandbox.presets?.map((p) => p.id).slice(0, 5)).toEqual(order);
    // A preset picked from the menu: its three values land on the Session.
    const pick = { approvalMode: "allow-all", sandbox: { mode: "read-only", network: "open" } };
    const picked = await owner.patch(`/api/sessions/${created.session.sessionId}`, pick);
    expect(picked.status).toBe(200);
    expect(((await picked.json()) as Created).session).toMatchObject(pick);
  });

  it("reports no backend for this OS, the OS's default packages, and names its switch", async () => {
    const entry = await (await boot()).card();
    expect(entry.backend).toEqual({ installed: false, ...(recommended ? { recommended } : {}) });
    expect(
      entry.notices?.find((n) => n.text.startsWith("This deployment has no usable")),
    ).toMatchObject({ tone: "attention" });
    expect(entry.configuration.switch).toBe("enabled");
  });

  it("explains every preset row and every value a row's choice can take, in both languages", async () => {
    const presets = (await (await boot()).card()).configuration.properties.presets!;
    const described = { description: expect.any(String), descriptionZh: expect.any(String) };
    for (const row of presets.rows!) expect(row, row.id).toMatchObject(described);
    for (const column of presets.columns!.filter((c) => c.type === "enum"))
      for (const option of column.options!)
        expect(option, `${column.name}.${option.value}`).toMatchObject(described);
  });

  it("forces tenant read masks and the current ceiling on a member's stored full access", async () => {
    let seen: SandboxPolicy | null = null;
    const recorder: SandboxProvider = {
      dimensions: ["fs-write", "network", "mask-paths"],
      confine(argv, policy) {
        seen = policy;
        return {
          argv: ["confined", ...argv],
          enforcement: "full",
          denialSignatures: [],
          runnerFailureRules: [],
        };
      },
    };
    const { t, save } = await boot({
      plugins: backendPlugin({ "recorder.provider": recorder }),
    });
    expect((await save({ enabled: true, defaultPreset: "full-access" })).status).toBe(200);

    const owner = apiClient(t.app, (await provisionUser(t.app, "owner_masks")).cookie);
    const member = apiClient(t.app, (await provisionUser(t.app, "member_masks")).cookie);
    const projectId = (
      (await (
        await owner.post("/api/projects", {
          projectId: "owner_masks-team",
          name: "Team",
        })
      ).json()) as { project: { projectId: string } }
    ).project.projectId;
    expect(
      (
        await owner.post(`/api/projects/${projectId}/members`, {
          userId: "member_masks",
        })
      ).status,
    ).toBe(201);
    const model = { provider: "anthropic", modelId: "claude-sonnet-4-6" };
    expect(
      (
        await owner.put(`/api/projects/${projectId}/models`, {
          defaultModel: model,
          models: [{ ...model, contextWindow: 128000 }],
        })
      ).status,
    ).toBe(200);
    const created = await member.post(
      `/api/projects/${projectId}/agents/default_agent/sessions`,
      {},
    );
    expect(created.status).toBe(201);
    const session = (
      (await created.json()) as {
        session: { sessionId: string; workspace: string; sandbox: SessionSandbox };
      }
    ).session;
    expect(session.sandbox.mode).toBe("danger-full-access");

    const env = t.deps.tree.api<SessionEnv>("SessionsModule", "env");
    const confiner = env.confineSpawn({
      projectId,
      agentId: "default_agent",
      sessionId: session.sessionId,
    });
    expect(confiner).not.toBeNull();
    expect(
      confiner!(["true"], {
        cwd: session.workspace,
        workspaceDir: session.workspace,
      }).argv[0],
    ).toBe("confined");
    expect(seen).not.toBeNull();
    expect(seen!.mode).toBe("danger-full-access");

    // The server ceiling tightens what the stored row may do, without rewriting the row.
    expect((await save({ defaultPreset: "workspace-write" })).status).toBe(200);
    expect(
      confiner!(["true"], {
        cwd: session.workspace,
        workspaceDir: session.workspace,
      }).argv[0],
    ).toBe("confined");
    expect(seen!.mode).toBe("workspace-write");
    expect(seen!.maskPaths).toEqual(
      expect.arrayContaining([
        path.join(t.root, "default_project"),
        path.join(t.root, "owner_masks-default_project"),
        path.join(t.root, "member_masks-default_project"),
        path.join(t.root, "api-token"),
      ]),
    );
    expect(seen!.maskPaths).not.toContain(session.workspace);
    expect(seen!.maskPaths).not.toContain(path.join(t.root, projectId));
  });

  it("keeps a nested member subagent's own Agent state and shared Workspace visible", async () => {
    let seen: SandboxPolicy | null = null;
    const recorder: SandboxProvider = {
      dimensions: ["fs-write", "network", "mask-paths"],
      confine(argv, policy) {
        seen = policy;
        return {
          argv: ["confined", ...argv],
          enforcement: "full",
          denialSignatures: [],
          runnerFailureRules: [],
        };
      },
    };
    const { t, save } = await boot({
      plugins: backendPlugin({ "recorder.provider": recorder }),
    });
    expect((await save({ enabled: true, defaultPreset: "full-access" })).status).toBe(200);

    const owner = apiClient(t.app, (await provisionUser(t.app, "owner_nested_masks")).cookie);
    const member = apiClient(t.app, (await provisionUser(t.app, "member_nested_masks")).cookie);
    const projectId = (
      (await (
        await owner.post("/api/projects", {
          projectId: "owner_nested_masks-team",
          name: "Team",
        })
      ).json()) as { project: { projectId: string } }
    ).project.projectId;
    expect(
      (
        await owner.post(`/api/projects/${projectId}/members`, {
          userId: "member_nested_masks",
        })
      ).status,
    ).toBe(201);
    const model = { provider: "anthropic", modelId: "claude-sonnet-4-6" };
    expect(
      (
        await owner.put(`/api/projects/${projectId}/models`, {
          defaultModel: model,
          models: [{ ...model, contextWindow: 128000 }],
        })
      ).status,
    ).toBe(200);
    const created = await member.post(
      `/api/projects/${projectId}/agents/default_agent/sessions`,
      {},
    );
    expect(created.status).toBe(201);
    const session = (
      (await created.json()) as {
        session: { sessionId: string; workspace: string; sandbox: SessionSandbox };
      }
    ).session;

    const leadAgentDir = path.join(t.root, projectId, "agents", "lead_statistician");
    const unrelatedAgentDir = path.join(t.root, projectId, "agents", "sap_author");
    await fs.mkdir(path.join(leadAgentDir, "agent_state", "skills"), { recursive: true });
    await fs.mkdir(path.join(unrelatedAgentDir, "agent_state"), { recursive: true });
    const now = new Date().toISOString();
    t.deps.sessionsRepo.insert({
      sessionId: "session-nested-lead",
      projectId,
      ownerUserId: "member_nested_masks",
      agentId: "lead_statistician",
      provider: model.provider,
      modelId: model.modelId,
      workspace: session.workspace,
      approvalMode: "allow-all",
      title: null,
      lastActiveAt: now,
      createdAt: now,
    });
    const childRoots = (
      t.deps.manager as unknown as {
        childRoots: Map<string, string>;
      }
    ).childRoots;
    childRoots.set("session-nested-lead", session.sessionId);

    const env = t.deps.tree.api<SessionEnv>("SessionsModule", "env");
    const confiner = env.confineSpawn({
      projectId,
      agentId: "lead_statistician",
      sessionId: "session-nested-lead",
    });
    expect(confiner).not.toBeNull();
    confiner!(["true"], {
      cwd: session.workspace,
      workspaceDir: session.workspace,
    });

    const masks = seen!.maskPaths ?? [];
    expect(masks).not.toContain(leadAgentDir);
    expect(
      masks.filter((mask) => {
        const resolved = path.resolve(mask);
        const workspace = path.resolve(session.workspace);
        return (
          resolved.startsWith(`${path.resolve(t.root, projectId)}${path.sep}`) &&
          (workspace === resolved || workspace.startsWith(`${resolved}${path.sep}`))
        );
      }),
    ).toEqual([]);
    expect(masks).toContain(unrelatedAgentDir);
  });

  it.each([
    ["declined only", { "elsewhere.provider": Promise.resolve(null) }, false],
    [
      "installed and failing",
      {
        "elsewhere.provider": Promise.resolve(null),
        // A loader, so the failure is not an unhandled rejection before the service asks.
        "broken.provider": () => Promise.reject(new Error("'bwrap' is missing")),
      },
      true,
    ],
    ["in use", { "fake.provider": PROVIDER }, true],
  ])("counts a backend %s as installed: %s", async (_, bind, installed) => {
    const { card } = await boot({ plugins: backendPlugin(bind) });
    expect((await card()).backend?.installed).toBe(installed);
  });
});
