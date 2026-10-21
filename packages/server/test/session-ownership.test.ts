/**
 * Session ownership: one shared Project/Agent, but a person's conversations are private.
 * Admin keeps the cross-Project operator view; members see and open only their own Sessions.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { sessionMeta, userText } from "@prismshadow/penguin-core";
import type {
  AgentTracesResponse,
  ProjectCreateResponse,
  SessionCreateResponse,
  SessionResponse,
  SessionsResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin, provisionUser, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const MODEL = { provider: "anthropic", modelId: "claude-sonnet-4-6" };

describe("session ownership", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let peer: ReturnType<typeof apiClient>;
  let projectId: string;

  beforeEach(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    member = apiClient(t.app, (await provisionUser(t.app, "colleague")).cookie);
    peer = apiClient(t.app, (await provisionUser(t.app, "teammate")).cookie);
    const created = (await (
      await admin.post("/api/projects", {
        projectId: "sharedteam",
        name: "Shared team",
      })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    expect(
      (
        await admin.post(`/api/projects/${projectId}/members`, {
          userId: "colleague",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await admin.post(`/api/projects/${projectId}/members`, {
          userId: "teammate",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await admin.put(`/api/projects/${projectId}/models`, {
          defaultModel: MODEL,
          models: [MODEL],
        })
      ).status,
    ).toBe(200);
  });

  afterEach(async () => {
    await t.cleanup();
  });

  async function createSession(client: ReturnType<typeof apiClient>) {
    const response = await client.post(
      `/api/projects/${projectId}/agents/default_agent/sessions`,
      {},
    );
    expect(response.status).toBe(201);
    return ((await response.json()) as SessionCreateResponse).session;
  }

  it("keeps each member's Session private while leaving the admin a full view", async () => {
    const adminSession = (await createSession(admin)).sessionId;
    const memberSession = (await createSession(member)).sessionId;

    expect((await admin.get(`/api/sessions/${adminSession}`)).status).toBe(200);
    expect((await member.get(`/api/sessions/${memberSession}`)).status).toBe(200);
    expect((await member.get(`/api/sessions/${adminSession}`)).status).toBe(404);
    expect((await admin.get(`/api/sessions/${memberSession}`)).status).toBe(200);

    const adminList = (await (
      await admin.get(`/api/projects/${projectId}/agents/default_agent/sessions`)
    ).json()) as SessionsResponse;
    expect(adminList.sessions.map((s) => s.sessionId)).toEqual(
      expect.arrayContaining([adminSession, memberSession]),
    );

    const memberList = (await (
      await member.get(`/api/projects/${projectId}/agents/default_agent/sessions`)
    ).json()) as SessionsResponse;
    expect(memberList.sessions.map((s) => s.sessionId)).toEqual([memberSession]);
  });

  it("keeps two ordinary colleagues' Sessions private from each other", async () => {
    const memberSession = (await createSession(member)).sessionId;
    const peerSession = (await createSession(peer)).sessionId;

    expect((await member.get(`/api/sessions/${memberSession}`)).status).toBe(200);
    expect((await peer.get(`/api/sessions/${peerSession}`)).status).toBe(200);
    expect((await member.get(`/api/sessions/${peerSession}`)).status).toBe(404);
    expect((await peer.get(`/api/sessions/${memberSession}`)).status).toBe(404);
    expect((await member.get(`/api/sessions/${peerSession}/messages`)).status).toBe(404);
    expect((await member.get(`/api/sessions/${peerSession}/files?path=`)).status).toBe(404);

    const memberList = (await (
      await member.get(`/api/projects/${projectId}/agents/default_agent/sessions`)
    ).json()) as SessionsResponse;
    const peerList = (await (
      await peer.get(`/api/projects/${projectId}/agents/default_agent/sessions`)
    ).json()) as SessionsResponse;
    expect(memberList.sessions.map((s) => s.sessionId)).toEqual([memberSession]);
    expect(peerList.sessions.map((s) => s.sessionId)).toEqual([peerSession]);
  });

  it("gives each member a private default Workspace and refuses another member's Workspace", async () => {
    const memberSession = await createSession(member);
    const peerSession = await createSession(peer);

    expect(path.basename(memberSession.workspace)).toBe("user-colleague");
    expect(path.basename(peerSession.workspace)).toBe("user-teammate");
    expect(memberSession.workspace).not.toBe(peerSession.workspace);

    const ownFiles = await member.get(
      `/api/projects/${projectId}/workspace-files?workspace=${encodeURIComponent(memberSession.workspace)}&path=`,
    );
    expect(ownFiles.status).toBe(200);
    const peerFiles = await member.get(
      `/api/projects/${projectId}/workspace-files?workspace=${encodeURIComponent(peerSession.workspace)}&path=`,
    );
    expect(peerFiles.status).toBe(404);
    expect(
      (
        await member.get(
          `/api/projects/${projectId}/dirs?path=${encodeURIComponent(memberSession.workspace)}`,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await member.get(
          `/api/projects/${projectId}/dirs?path=${encodeURIComponent(peerSession.workspace)}`,
        )
      ).status,
    ).toBe(404);

    const escaped = await member.post(`/api/projects/${projectId}/agents/default_agent/sessions`, {
      workspace: peerSession.workspace,
    });
    expect(escaped.status).toBe(403);
    expect(((await escaped.json()) as { error: { code: string } }).error.code).toBe(
      "workspace_forbidden",
    );
  });

  it("keeps Agent-level Trace listing and detail within each member's own Sessions", async () => {
    const memberSession = await createSession(member);
    const peerSession = await createSession(peer);
    for (const session of [memberSession, peerSession]) {
      await writeTraceFile(t.root, projectId, "default_agent", "2026-10-21", session.sessionId, 1, [
        sessionMeta({
          session_id: session.sessionId,
          model_id: session.modelId,
          provider: session.provider,
          model_context_window: 128000,
          system_prompt: "",
          agent_state: path.join(t.root, projectId, "agents", "default_agent", "agent_state"),
          workspace: session.workspace,
          source: "user",
        }),
        userText(`${session.sessionId} private prompt`),
      ]);
    }

    const base = `/api/projects/${projectId}/agents/default_agent/traces`;
    const memberPage = (await (await member.get(`${base}?limit=10`)).json()) as AgentTracesResponse;
    expect(memberPage.sessions?.map((s) => s.sessionId)).toEqual([memberSession.sessionId]);
    expect((await member.get(`${base}/${peerSession.sessionId}/1`)).status).toBe(404);

    const adminPage = (await (await admin.get(`${base}?limit=10`)).json()) as AgentTracesResponse;
    expect(adminPage.sessions?.map((s) => s.sessionId)).toEqual(
      expect.arrayContaining([memberSession.sessionId, peerSession.sessionId]),
    );
  });

  it("does not let a member edit the shared Agent configuration", async () => {
    const response = await member.put(`/api/projects/${projectId}/agents/default_agent/config`, {
      agentsMd: "# changed by a member",
    });
    expect(response.status).toBe(403);
  });

  it("keeps an admin's Session invisible in the member's session lookup", async () => {
    const adminSession = (await createSession(admin)).sessionId;
    const response = await member.get(`/api/sessions/${adminSession}`);
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "session_not_found",
    );
    const memberResponse = (await (
      await admin.get(`/api/sessions/${adminSession}`)
    ).json()) as SessionResponse;
    expect(memberResponse.session.sessionId).toBe(adminSession);
  });
});
