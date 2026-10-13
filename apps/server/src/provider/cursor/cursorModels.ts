import type { ClientSideConnection, SessionConfigOption } from "@agentclientprotocol/sdk";

import type { AcpModelDescription } from "../acp/acpProviderProfile.ts";

// Cursor's own model list: every model with its display name and its parameters (effort,
// thinking, fast, context) as session config options, read without switching models.
const LIST_MODELS_METHOD = "cursor/list_available_models";

const VENDORS: Readonly<Record<string, string>> = {
  claude: "Anthropic",
  gpt: "OpenAI",
  gemini: "Google",
  grok: "xAI",
  composer: "Cursor",
  kimi: "Moonshot AI",
  glm: "Z.ai",
  muse: "Meta",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function describeCursorModels(
  agent: ClientSideConnection,
): Promise<ReadonlyArray<AcpModelDescription>> {
  const response = await agent.extMethod(LIST_MODELS_METHOD, {});
  const models = Array.isArray(response.models) ? response.models : [];
  return models.flatMap((model): AcpModelDescription[] =>
    isRecord(model) && typeof model.value === "string"
      ? [
          {
            slug: model.value,
            name: typeof model.name === "string" ? model.name : model.value,
            configOptions: Array.isArray(model.configOptions)
              ? (model.configOptions as SessionConfigOption[])
              : [],
          },
        ]
      : [],
  );
}

export function cursorModelVendor(slug: string): string | undefined {
  return VENDORS[slug.split("-")[0] ?? ""];
}
