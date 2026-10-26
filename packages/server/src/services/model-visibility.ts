import type { ModelsResponse } from "../api/types.js";

/**
 * The model library is administrative configuration. A system admin sees every configured
 * entry; every other account sees only the Project's current default when it is DeepSeek.
 * Provider connection tables are trimmed with it so no empty group names leak into the member
 * view.
 */
export function filterModelsForViewer(full: ModelsResponse, isAdmin: boolean): ModelsResponse {
  if (isAdmin) return full;
  const ref = full.defaultModel;
  const models =
    ref?.provider === "deepseek"
      ? full.models.filter((m) => m.provider === ref.provider && m.modelId === ref.modelId)
      : [];
  const providers = Object.fromEntries(
    Object.entries(full.providers).filter(([provider]) =>
      models.some((m) => m.provider === provider),
    ),
  );
  const visibleDefault = models.length > 0 ? ref : undefined;
  const visionModel =
    full.visionModel !== undefined &&
    models.some(
      (m) => m.provider === full.visionModel!.provider && m.modelId === full.visionModel!.modelId,
    )
      ? full.visionModel
      : undefined;
  return {
    ...full,
    providers,
    models,
    ...(visibleDefault !== undefined
      ? { defaultModel: visibleDefault }
      : { defaultModel: undefined }),
    ...(visionModel !== undefined ? { visionModel } : { visionModel: undefined }),
  };
}
