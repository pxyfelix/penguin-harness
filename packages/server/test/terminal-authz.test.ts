/**
 * The server terminal runs directly as the service account, outside the Agent sandbox.
 * Until each terminal is confined, only administrators may reach the terminal plane.
 */
import { describe, expect, it } from "vitest";
import type { TerminalManager } from "../src/terminal/manager.js";
import type { Identity } from "../src/terminal/identity.js";
import { terminalRoutes } from "../src/terminal/routes.js";

function manager(): TerminalManager {
  return {
    listInfo: () => [],
  } as unknown as TerminalManager;
}

function identity(isAdmin: boolean): Identity {
  return async () => ({ userId: isAdmin ? "admin" : "member", isAdmin });
}

describe("terminal authorization", () => {
  it("refuses every terminal operation to an ordinary member", async () => {
    const app = terminalRoutes(manager(), identity(false));
    for (const [method, path] of [
      ["GET", "/api/terminals"],
      ["POST", "/api/terminals"],
      ["GET", "/api/terminals/terminal-1"],
      ["DELETE", "/api/terminals/terminal-1"],
      ["GET", "/api/terminals/terminal-1/capture"],
      ["POST", "/api/terminals/terminal-1/keys"],
    ] as const) {
      expect((await app.request(path, { method })).status, `${method} ${path}`).toBe(403);
    }
  });

  it("keeps the terminal plane available to an administrator", async () => {
    const app = terminalRoutes(manager(), identity(true));
    const response = await app.request("/api/terminals");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ terminals: [] });
  });
});
