import type { ModelSelection, RuntimeMode } from "@glade/contracts/provider/sessionPolicy";
import type { OrchestrationSession } from "@glade/contracts/orchestration/threadEntities";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";

export function deriveTurnStartModelSelection(input: {
  readonly currentModelSelection: ModelSelection;
  readonly requestedModelSelection: ModelSelection | undefined;
  readonly canAdoptRequestedProvider: boolean;
}): ModelSelection {
  const requestedModelSelection = input.requestedModelSelection;
  return requestedModelSelection !== undefined &&
    (requestedModelSelection.provider === input.currentModelSelection.provider ||
      input.canAdoptRequestedProvider)
    ? requestedModelSelection
    : input.currentModelSelection;
}

// Imported fork history must not freeze the first-turn provider like native history does.
function countNativeTurnStartMessages(
  messages: ReadonlyArray<{ readonly source?: string | null }>,
): number {
  let count = 0;
  for (const message of messages) {
    if ((message.source ?? "native") !== "fork-import") {
      count += 1;
    }
  }
  return count;
}

export function canAdoptFirstTurnProvider(input: {
  readonly hasLatestTurn: boolean;
  readonly hasSession: boolean;
  readonly messages: ReadonlyArray<{ readonly source?: string | null }>;
}): boolean {
  return (
    !input.hasLatestTurn && !input.hasSession && countNativeTurnStartMessages(input.messages) <= 1
  );
}

export function deriveTurnStartSession(input: {
  readonly threadId: ThreadId;
  readonly currentSession: OrchestrationSession | null;
  readonly providerName: OrchestrationSession["providerName"];
  readonly requestedRuntimeMode: RuntimeMode;
  readonly requestedAt: string;

  readonly sessionProviderEstablished?: boolean;
}): OrchestrationSession | null {
  if (input.currentSession?.status === "starting" || input.currentSession?.status === "running") {
    return null;
  }

  const sessionProviderName =
    input.currentSession?.providerName != null && input.sessionProviderEstablished !== false
      ? input.currentSession.providerName
      : undefined;

  return {
    threadId: input.threadId,
    status: "starting",
    providerName: sessionProviderName ?? input.providerName,
    runtimeMode: input.currentSession?.runtimeMode ?? input.requestedRuntimeMode,
    activeTurnId: null,
    lastError: null,
    updatedAt: input.requestedAt,
  };
}
