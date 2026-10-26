import { describe, expect, it } from "vitest";
import type { ModelInfo, ModelsResponse } from "../src/api/types.js";
import { filterModelsForViewer } from "../src/services/model-visibility.js";

const model = (provider: string, modelId: string, isDefault: boolean): ModelInfo => ({
  provider,
  modelId,
  isDefault,
  effective: {
    baseUrlSource: "none",
    clientTypeSource: "none",
    apiKeySource: "none",
  },
});

const full: ModelsResponse = {
  updatedAt: "2026-10-26T00:00:00.000Z",
  defaultModel: { provider: "deepseek", modelId: "deepseek-v4-flash" },
  visionModel: { provider: "openai", modelId: "gpt-6" },
  providers: {
    deepseek: { apiKeyMasked: "sk-d…1234" },
    openai: { apiKeyMasked: "sk-o…5678" },
  },
  models: [
    model("deepseek", "deepseek-v4-flash", true),
    model("deepseek", "deepseek-v4-pro", false),
    model("openai", "gpt-6", false),
  ],
};

describe("model visibility by role", () => {
  it("admins receive the complete configured model table", () => {
    expect(filterModelsForViewer(full, true)).toBe(full);
  });

  it("other users receive only the configured default DeepSeek entry", () => {
    const visible = filterModelsForViewer(full, false);

    expect(visible.updatedAt).toBe(full.updatedAt);
    expect(visible.defaultModel).toEqual(full.defaultModel);
    expect(visible.models.map((m) => [m.provider, m.modelId])).toEqual([
      ["deepseek", "deepseek-v4-flash"],
    ]);
    expect(visible.providers).toEqual({ deepseek: full.providers.deepseek });
    expect(visible.visionModel).toBeUndefined();
  });

  it("does not leak another provider when the default model is not DeepSeek", () => {
    const nonDeepSeekDefault: ModelsResponse = {
      ...full,
      defaultModel: { provider: "openai", modelId: "gpt-6" },
      models: full.models.map((m) => ({
        ...m,
        isDefault: m.provider === "openai" && m.modelId === "gpt-6",
      })),
    };

    expect(filterModelsForViewer(nonDeepSeekDefault, false)).toMatchObject({
      providers: {},
      models: [],
    });
  });
});
