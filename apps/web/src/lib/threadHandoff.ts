import { type ProviderKind } from "@glade/contracts/core/baseSchemas";
import { type ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import { type ServerProviderStatus } from "@glade/contracts/server/server";
import { type ServerSettingsView } from "@glade/contracts/settings/settings";
import { type Thread } from "../types";
import { DEFAULT_PROVIDER_ORDER } from "../providerOrdering";
import { findProviderStatus, isProviderUsable } from "./providerAvailability";

function isImportableThreadMessage(
  message: Thread["messages"][number],
): message is Thread["messages"][number] & {
  role: "user" | "assistant";
} {
  return (message.role === "user" || message.role === "assistant") && message.streaming === false;
}

export function isEligibleHandoffTargetProvider(input: {
  readonly sourceProvider: ProviderKind;
  readonly targetProvider: ProviderKind;
  readonly targetProviderEnabled: boolean | null | undefined;
  readonly targetProviderStatus: ServerProviderStatus | null | undefined;
}): boolean {
  return (
    input.targetProvider !== input.sourceProvider &&
    input.targetProviderEnabled === true &&
    input.targetProviderStatus?.provider === input.targetProvider &&
    isProviderUsable(input.targetProviderStatus)
  );
}

export function resolveAvailableHandoffTargetProviders(input: {
  readonly sourceProvider: ProviderKind;
  readonly providerSettings: ServerSettingsView["providers"] | null | undefined;
  readonly providerStatuses: readonly ServerProviderStatus[];
}): ReadonlyArray<ProviderKind> {
  return DEFAULT_PROVIDER_ORDER.filter((targetProvider) =>
    isEligibleHandoffTargetProvider({
      sourceProvider: input.sourceProvider,
      targetProvider,
      targetProviderEnabled: input.providerSettings?.[targetProvider].enabled,
      targetProviderStatus: findProviderStatus(input.providerStatuses, targetProvider),
    }),
  );
}

function hasNativeThreadHandoffMessages(thread: Pick<Thread, "messages">): boolean {
  return thread.messages.some(
    (message) =>
      isImportableThreadMessage(message) &&
      (message.source === "native" || message.source === "async-user-input"),
  );
}

export function canCreateThreadHandoff(input: {
  readonly thread: Pick<Thread, "handoff" | "messages" | "session">;
  readonly isBusy?: boolean;
  readonly hasPendingApprovals?: boolean;
  readonly hasPendingUserInput?: boolean;
}): boolean {
  if (input.isBusy || input.hasPendingApprovals || input.hasPendingUserInput) {
    return false;
  }
  const sessionStatus = input.thread.session?.orchestrationStatus;
  if (sessionStatus === "starting" || sessionStatus === "running") {
    return false;
  }
  if (!input.thread.messages.some(isImportableThreadMessage)) {
    return false;
  }
  if (
    ["preparing", "activating", "activated", "uncertain"].includes(
      input.thread.handoff?.stage ?? "",
    )
  )
    return false;
  if (input.thread.handoff !== null) {
    return hasNativeThreadHandoffMessages(input.thread);
  }
  return true;
}

export function resolveThreadHandoffModelSelection(input: {
  readonly sourceThread: Pick<Thread, "modelSelection">;
  readonly targetProvider: ProviderKind;
  readonly projectDefaultModelSelection: ModelSelection | null | undefined;
  readonly stickyModelSelectionByProvider: Partial<Record<ProviderKind, ModelSelection>>;
}): ModelSelection {
  const isCompatibleSelection = (
    selection: ModelSelection | null | undefined,
  ): selection is ModelSelection => {
    return Boolean(selection && selection.provider === input.targetProvider);
  };

  const stickySelection = input.stickyModelSelectionByProvider[input.targetProvider];
  if (isCompatibleSelection(stickySelection)) {
    return stickySelection;
  }
  if (isCompatibleSelection(input.projectDefaultModelSelection)) {
    return input.projectDefaultModelSelection;
  }
  return {
    provider: input.targetProvider,
    model: "",
  };
}
