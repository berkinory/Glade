import {
  type ModelSelection,
  type ProviderStartOptions,
} from "@glade/contracts/provider/sessionPolicy";
import { type ServerSettings, type ServerSettingsPatch } from "@glade/contracts/settings/settings";
import { deepMerge, type DeepPartial } from "./settingsMerge";

export function applyServerSettingsPatch(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettings {
  const next = deepMerge(current, patch as DeepPartial<ServerSettings>);
  const selectionPatch = patch.textGenerationModelSelection;
  if (selectionPatch === undefined) return next;
  if (selectionPatch === null) return { ...next, textGenerationModelSelection: null };
  const previous = current.textGenerationModelSelection;
  const provider = selectionPatch.provider ?? previous?.provider ?? "codex";
  const model =
    selectionPatch.model ?? (provider === previous?.provider ? previous.model : undefined);
  if (!model) return { ...next, textGenerationModelSelection: null };
  const options =
    selectionPatch.provider !== undefined || selectionPatch.model !== undefined
      ? selectionPatch.options
      : (selectionPatch.options ?? previous?.options);
  return {
    ...next,
    textGenerationModelSelection: {
      provider,
      model,
      ...(options ? { options } : {}),
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
  const binaryOnly = (binaryPath: string) =>
    binaryPath.trim() ? { binaryPath: binaryPath.trim() } : {};
  return {
    codex: {
      ...(codexBinaryPath ? { binaryPath: codexBinaryPath } : {}),
      ...(codexHomePath ? { homePath: codexHomePath } : {}),
    },
    claudeAgent: {
      ...(claudeBinaryPath ? { binaryPath: claudeBinaryPath } : {}),
      enableArtifacts: providers.claudeAgent.enableArtifacts,
    },
    opencode: binaryOnly(providers.opencode.binaryPath),
    grok: binaryOnly(providers.grok.binaryPath),
    cursor: binaryOnly(providers.cursor.binaryPath),
    museCode: binaryOnly(providers.museCode.binaryPath),
    allowComputerUse: settings.allowComputerUse,
  };
}
