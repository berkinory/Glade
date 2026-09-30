import { DEFAULT_RUNTIME_MODE } from "@glade/contracts/provider/sessionPolicy";
import {
  type ProjectId,
  type ProviderKind,
  type ThreadId,
} from "@glade/contracts/core/baseSchemas";
import type { DraftThreadEnvMode, DraftThreadState } from "../composerDraftDomain";

export interface NewThreadOptions {
  branch?: string | null;
  worktreePath?: string | null;
  workingDirectory?: string | null;
  envMode?: DraftThreadEnvMode;
  provider?: ProviderKind;
  fresh?: boolean;

  standalone?: boolean;
}

interface DraftReusePlanStored {
  draftThread: DraftThreadState;
  kind: "stored";
  threadId: ThreadId;
}

interface DraftReusePlanRoute {
  draftThread: DraftThreadState;
  kind: "route";
  threadId: ThreadId;
}

interface DraftReusePlanFresh {
  kind: "fresh";
}

export type ThreadBootstrapPlan = DraftReusePlanStored | DraftReusePlanRoute | DraftReusePlanFresh;

export function resolveThreadBootstrapPlan(input: {
  latestActiveDraftThread: DraftThreadState | null;
  projectId: ProjectId;
  routeThreadId: ThreadId | null;
  storedDraftThread: ({ threadId: ThreadId } & DraftThreadState) | null;
}): ThreadBootstrapPlan {
  if (
    shouldReuseActiveDraftThread({
      draftThread: input.latestActiveDraftThread,
      projectId: input.projectId,
      routeThreadId: input.routeThreadId,
    })
  ) {
    return {
      kind: "route",
      threadId: input.routeThreadId!,
      draftThread: input.latestActiveDraftThread!,
    };
  }
  if (input.storedDraftThread) {
    return {
      kind: "stored",
      threadId: input.storedDraftThread.threadId,
      draftThread: input.storedDraftThread,
    };
  }
  return { kind: "fresh" };
}

export function createFreshDraftThreadSeed(input: {
  createdAt: string;
  options: NewThreadOptions | undefined;
  defaultEnvMode?: DraftThreadEnvMode;
}): Omit<DraftThreadState, "projectId" | "interactionMode"> {
  return {
    createdAt: input.createdAt,
    branch: input.options?.branch ?? null,
    worktreePath: input.options?.worktreePath ?? null,
    workingDirectory: input.options?.workingDirectory ?? null,
    envMode:
      input.options?.envMode ??
      (input.options?.worktreePath ? "worktree" : (input.defaultEnvMode ?? "local")),
    runtimeMode: DEFAULT_RUNTIME_MODE,
  };
}

function hasDraftContextOverrides(options?: NewThreadOptions): boolean {
  return (
    options?.branch !== undefined ||
    options?.worktreePath !== undefined ||
    options?.workingDirectory !== undefined ||
    options?.envMode !== undefined
  );
}

export function buildDraftThreadContextPatch(options?: NewThreadOptions): {
  branch?: string | null;
  envMode?: DraftThreadEnvMode;
  worktreePath?: string | null;
  workingDirectory?: string | null;
} | null {
  if (!hasDraftContextOverrides(options)) {
    return null;
  }
  const shouldClearWorktreeForLocalMode =
    options?.envMode === "local" && options?.worktreePath === undefined;
  return {
    ...(options?.branch !== undefined ? { branch: options.branch ?? null } : {}),
    ...(options?.worktreePath !== undefined || shouldClearWorktreeForLocalMode
      ? { worktreePath: options?.worktreePath ?? null }
      : {}),
    ...(options?.workingDirectory !== undefined
      ? { workingDirectory: options.workingDirectory ?? null }
      : {}),
    ...(options?.envMode !== undefined ? { envMode: options.envMode } : {}),
  };
}

function shouldReuseActiveDraftThread(input: {
  draftThread: DraftThreadState | null;
  projectId: ProjectId;
  routeThreadId: ThreadId | null;
}): input is {
  draftThread: DraftThreadState;
  projectId: ProjectId;
  routeThreadId: ThreadId;
} {
  return Boolean(
    input.draftThread && input.routeThreadId && input.draftThread.projectId === input.projectId,
  );
}
