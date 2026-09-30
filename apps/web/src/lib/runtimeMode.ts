import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ProviderModelDescriptor } from "@glade/contracts/provider/providerDiscovery";
import type { RuntimeMode } from "@glade/contracts/provider/sessionPolicy";
import type { ServerProviderStatus } from "@glade/contracts/server/server";
import {
  normalizeRuntimeModeForProvider,
  providerSupportsAutoRuntimeMode,
} from "@glade/shared/threads/runtimeMode";

export { normalizeRuntimeModeForProvider, providerSupportsAutoRuntimeMode };

export function providerModelSupportsAutoRuntimeMode(
  provider: ProviderKind,
  runtimeModel?: ProviderModelDescriptor,
  providerStatus?: ServerProviderStatus | null,
): boolean {
  if (!providerSupportsAutoRuntimeMode(provider)) {
    return false;
  }
  return (
    providerStatus?.supportsAutoRuntimeMode === true &&
    (provider !== "claudeAgent" || runtimeModel?.supportsAutoMode === true)
  );
}

export const RUNTIME_MODE_PRESENTATION: Record<
  RuntimeMode,
  { readonly label: string; readonly description: string }
> = {
  "approval-required": {
    label: "Ask for approval",
    description: "Always ask to edit external files and use the internet",
  },
  auto: {
    label: "Approve for me",
    description: "Only ask for actions detected as potentially unsafe",
  },
  "full-access": {
    label: "Full access",
    description: "Unrestricted access to the internet and any file on your computer",
  },
};
