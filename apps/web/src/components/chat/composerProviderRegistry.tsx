import {
  type ModelSlug,
  type ProviderKind,
  type ProviderModelDescriptor,
  type ProviderModelOptions,
} from "@glade/contracts";
import {
  getDefaultEffort,
  hasEffortLevel,
  isClaudeUltrathinkPrompt,
  normalizeClaudeModelOptions,
  trimOrNull,
} from "@glade/shared/model";
import { classifyCodexReasoningEffortSupport } from "../../lib/codexReasoningEffort";
import { getRuntimeAwareModelCapabilities } from "./runtimeModelCapabilities";

export type ComposerProviderStateInput = {
  provider: ProviderKind;
  model: ModelSlug;
  runtimeModel?: ProviderModelDescriptor | undefined;
  prompt: string;
  modelOptions: ProviderModelOptions | null | undefined;
};

export type ComposerProviderState = {
  provider: ProviderKind;
  promptEffort: string | null;
  modelOptionsForDispatch: ProviderModelOptions[ProviderKind] | undefined;
  composerFrameClassName?: string;
  composerSurfaceClassName?: string;
  modelPickerIconClassName?: string;
};

export function getComposerProviderState(input: ComposerProviderStateInput): ComposerProviderState {
  const { provider, model, runtimeModel, prompt, modelOptions } = input;
  const caps = getRuntimeAwareModelCapabilities({ provider, model, runtimeModel });

  let rawEffort: string | null = null;
  let normalizedOptions: ProviderModelOptions[ProviderKind] | undefined;

  switch (provider) {
    case "codex": {
      const providerOptions = modelOptions?.codex;
      rawEffort = trimOrNull(providerOptions?.reasoningEffort);
      const defaultReasoningEffort = getDefaultEffort(caps);
      const reasoningEffortSupport = classifyCodexReasoningEffortSupport({
        model,
        effort: rawEffort,
        ...(runtimeModel ? { runtimeModel } : {}),
      });
      const reasoningEffort =
        rawEffort &&
        reasoningEffortSupport !== "unsupported" &&
        rawEffort !== defaultReasoningEffort
          ? rawEffort
          : undefined;
      const fastModeEnabled = caps.supportsFastMode && providerOptions?.fastMode === true;
      const nextOptions = {
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(fastModeEnabled || providerOptions?.fastMode === false
          ? { fastMode: fastModeEnabled }
          : {}),
      };
      normalizedOptions = Object.keys(nextOptions).length > 0 ? nextOptions : undefined;
      break;
    }
    case "claudeAgent": {
      const providerOptions = modelOptions?.claudeAgent;
      rawEffort = trimOrNull(providerOptions?.effort);
      normalizedOptions = normalizeClaudeModelOptions(model, providerOptions);
      break;
    }
  }

  const draftEffort = trimOrNull(rawEffort);
  const defaultEffort = getDefaultEffort(caps);
  const isPromptInjected = draftEffort
    ? caps.promptInjectedEffortLevels.includes(draftEffort)
    : false;
  const promptEffort =
    draftEffort &&
    !isPromptInjected &&
    (provider === "codex"
      ? classifyCodexReasoningEffortSupport({
          model,
          effort: draftEffort,
          ...(runtimeModel ? { runtimeModel } : {}),
        }) !== "unsupported"
      : hasEffortLevel(caps, draftEffort))
      ? draftEffort
      : defaultEffort && hasEffortLevel(caps, defaultEffort)
        ? defaultEffort
        : null;

  const ultrathinkActive =
    caps.promptInjectedEffortLevels.length > 0 && isClaudeUltrathinkPrompt(prompt);

  return {
    provider,
    promptEffort,
    modelOptionsForDispatch: normalizedOptions,
    ...(ultrathinkActive ? { composerFrameClassName: "ultrathink-frame" } : {}),
    ...(ultrathinkActive ? { modelPickerIconClassName: "ultrathink-chroma" } : {}),
  };
}
