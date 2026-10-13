import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { RuntimeMode } from "@glade/contracts/provider/sessionPolicy";
import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import { providerCapabilities } from "../provider/providerMetadata";

const RUNTIME_MODE_PRIVILEGE = {
  "approval-required": 0,
  auto: 1,
  "full-access": 2,
} as const satisfies Record<RuntimeMode, number>;

export function providerSupportsAutoRuntimeMode(provider: ProviderKind): boolean {
  return providerCapabilities(provider).autoRuntimeMode !== "none";
}

export function unsupportedAutoRuntimeModeMessage(provider: ProviderKind): string {
  return `Provider "${provider}" does not support Auto runtime mode.`;
}

// An unknown model capability fails closed where the provider decides per model: its adapter refuses to
// start Auto sessions without a confirmed flag, so accepting Auto here would only defer the failure.
export function modelSupportsAutoRuntimeMode(
  provider: ProviderKind,
  supportsAutoMode: boolean | undefined,
): boolean {
  switch (providerCapabilities(provider).autoRuntimeMode) {
    case "provider":
      return supportsAutoMode !== false;
    case "model":
      return supportsAutoMode === true;
    case "none":
      return false;
  }
}

export function autoRuntimeModeSelectionIssue(input: {
  readonly runtimeMode: RuntimeMode;
  readonly modelSelection: {
    readonly provider: ProviderKind;
    readonly model: string;
    readonly supportsAutoMode?: boolean | undefined;
  };
}): string | null {
  const { provider, model, supportsAutoMode } = input.modelSelection;
  if (input.runtimeMode !== "auto") {
    return null;
  }
  if (!providerSupportsAutoRuntimeMode(provider)) {
    return unsupportedAutoRuntimeModeMessage(provider);
  }
  if (modelSupportsAutoRuntimeMode(provider, supportsAutoMode)) {
    return null;
  }
  return supportsAutoMode === false
    ? `${PROVIDER_DISPLAY_NAMES[provider]} model "${model}" does not support Auto mode.`
    : `${PROVIDER_DISPLAY_NAMES[provider]} model "${model}" has not been verified to support Auto mode.`;
}

export function runtimeModeEscalatesPrivilege(
  callerRuntimeMode: RuntimeMode,
  targetRuntimeMode: RuntimeMode,
): boolean {
  return RUNTIME_MODE_PRIVILEGE[targetRuntimeMode] > RUNTIME_MODE_PRIVILEGE[callerRuntimeMode];
}

export function normalizeRuntimeModeForProvider(
  runtimeMode: RuntimeMode,
  provider: ProviderKind,
): RuntimeMode {
  return runtimeMode === "auto" && !providerSupportsAutoRuntimeMode(provider)
    ? "approval-required"
    : runtimeMode;
}
