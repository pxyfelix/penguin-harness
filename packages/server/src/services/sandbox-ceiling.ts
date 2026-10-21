/**
 * The non-admin ceiling on a Session's sandbox: the server's settings. A non-admin may tighten a
 * Session's policy but never give it more file or network access than those settings
 * (`applySandboxPick`), and the composer greys out the presets wider than them
 * (`SessionSandboxPreset.aboveCeiling`) — both by this one comparison, so the menu never offers
 * a non-admin what the server will refuse.
 */
import type { SandboxSettings } from "@prismshadow/penguin-core/plugin";
import type { SessionSandbox } from "../api/types.js";

const SANDBOX_MODE_RANK: Record<SandboxSettings["mode"], number> = {
  "read-only": 0,
  "workspace-write": 1,
  "danger-full-access": 2,
};

const SANDBOX_NETWORK_RANK: Record<SessionSandbox["network"], number> = {
  none: 0,
  local: 1,
  open: 2,
};

/** A file mode and network level, as the composer names them. */
export type SandboxLevel = Pick<SessionSandbox, "mode" | "network">;

/**
 * Which dimension of `level` is wider than `ceiling` — the file mode first — or null when
 * neither is.
 */
export function aboveSandboxCeiling(
  level: SandboxLevel,
  ceiling: SandboxLevel,
): "mode" | "network" | null {
  if (SANDBOX_MODE_RANK[level.mode] > SANDBOX_MODE_RANK[ceiling.mode]) return "mode";
  if (SANDBOX_NETWORK_RANK[level.network] > SANDBOX_NETWORK_RANK[ceiling.network]) {
    return "network";
  }
  return null;
}

/**
 * An existing Session's policy tightened to a ceiling that may have changed since the row
 * was created. Member Sessions use this at every spawn: a policy stored before a ceiling
 * was saved may never outlive that new ceiling.
 */
export function tightenSandboxToCeiling(
  policy: SandboxSettings,
  ceiling: SandboxSettings,
): SandboxSettings {
  const mode =
    SANDBOX_MODE_RANK[policy.mode] > SANDBOX_MODE_RANK[ceiling.mode] ? ceiling.mode : policy.mode;
  const policyNetwork = policy.network ?? "open";
  const ceilingNetwork = ceiling.network ?? "open";
  const network =
    SANDBOX_NETWORK_RANK[policyNetwork] > SANDBOX_NETWORK_RANK[ceilingNetwork]
      ? ceilingNetwork
      : policyNetwork;
  const maskPaths = [...new Set([...(policy.maskPaths ?? []), ...(ceiling.maskPaths ?? [])])];
  const writableTemp =
    policy.writableTemp === false || ceiling.writableTemp === false
      ? false
      : (policy.writableTemp ?? ceiling.writableTemp);
  return {
    mode,
    ...(network === "open" ? {} : { network }),
    ...(maskPaths.length > 0 ? { maskPaths } : {}),
    ...(writableTemp !== undefined ? { writableTemp } : {}),
  };
}
