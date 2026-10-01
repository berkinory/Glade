import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import type { QueryClient } from "@tanstack/react-query";
import type { useNavigate } from "@tanstack/react-router";
import type { RefObject } from "react";
import type { readNativeApi } from "../nativeApi";
import type { useStore } from "../store";
import type { useTerminalStateStore } from "../terminalStateStore";
import type { useWorkspacePathsStore } from "../workspacePathsStore";
export interface StreamContext {
  api: NonNullable<ReturnType<typeof readNativeApi>>;
  syncServerShellSnapshot: ReturnType<typeof useStore.getState>["syncServerShellSnapshot"];
  syncServerThreadDetailHotPath: ReturnType<
    typeof useStore.getState
  >["syncServerThreadDetailHotPath"];
  applyShellEvent: ReturnType<typeof useStore.getState>["applyShellEvent"];
  applyOrchestrationEventsHotPath: ReturnType<
    typeof useStore.getState
  >["applyOrchestrationEventsHotPath"];
  setProjectExpanded: ReturnType<typeof useStore.getState>["setProjectExpanded"];
  removeOrphanedTerminalStates: ReturnType<
    typeof useTerminalStateStore.getState
  >["removeOrphanedTerminalStates"];
  setServerWorkspacePaths: ReturnType<
    typeof useWorkspacePathsStore.getState
  >["setServerWorkspacePaths"];
  queryClient: QueryClient;
  navigate: ReturnType<typeof useNavigate>;
  pathnameRef: RefObject<string>;
  handledBootstrapThreadIdRef: RefObject<string | null>;
  visibleThreadIdsRef: RefObject<readonly ThreadId[]>;
  reconcileThreadSubscriptionsRef: RefObject<((ids: readonly ThreadId[]) => Promise<void>) | null>;
}
export interface StreamOperations {
  queueDomainEvent: (event: OrchestrationEvent) => void;
  reconcileThreadProjection: (
    id: ThreadId,
    options?: { readonly queueIfInFlight?: boolean },
  ) => Promise<void>;
  removeOrphanedTerminalsForCurrentState: () => void;
}
