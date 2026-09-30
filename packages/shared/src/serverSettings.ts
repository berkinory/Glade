import { DEFAULT_MODEL_BY_PROVIDER } from "@glade/contracts/provider/model";
import {
  type ModelSelection,
  type ProviderStartOptions,
} from "@glade/contracts/orchestration/orchestration";
import { type ServerSettings, type ServerSettingsPatch } from "@glade/contracts/settings/settings";
import { deepMerge, type DeepPartial } from "./Struct";

function shouldReplaceTextGenerationModelSelection(
  patch: ServerSettingsPatch["textGenerationModelSelection"] | undefined,
): boolean {
  return Boolean(patch && (patch.provider !== undefined || patch.model !== undefined));
}

export function applyServerSettingsPatch(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettings {
  const selectionPatch = patch.textGenerationModelSelection;
  const next = deepMerge(current, patch as DeepPartial<ServerSettings>);
  if (!selectionPatch) {
    return next;
  }

  const provider = selectionPatch.provider ?? current.textGenerationModelSelection.provider;
  const model =
    selectionPatch.model ??
    (selectionPatch.provider &&
    selectionPatch.provider !== current.textGenerationModelSelection.provider
      ? DEFAULT_MODEL_BY_PROVIDER[selectionPatch.provider]
      : current.textGenerationModelSelection.model);
  const options = shouldReplaceTextGenerationModelSelection(selectionPatch)
    ? selectionPatch.options
    : (selectionPatch.options ?? current.textGenerationModelSelection.options);

  return {
    ...next,
    textGenerationModelSelection: {
      provider,
      model,
      ...(options !== undefined ? { options } : {}),
    } as ModelSelection,
  };
}

export function providerStartOptionsFromServerSettings(
  settings: ServerSettings,
): ProviderStartOptions {
  const { providers } = settings;
  const codexBinaryPath = providers.codex.binaryPath.trim();
  const codexHomePath = providers.codex.homePath.trim();
  const claudeBinaryPath = providers.claudeAgent.binaryPath.trim();
  return {
    codex: {
      ...(codexBinaryPath ? { binaryPath: codexBinaryPath } : {}),
      ...(codexHomePath ? { homePath: codexHomePath } : {}),
    },
    claudeAgent: {
      ...(claudeBinaryPath ? { binaryPath: claudeBinaryPath } : {}),
      enableArtifacts: providers.claudeAgent.enableArtifacts,
    },
  };
}
