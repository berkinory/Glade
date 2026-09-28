// FILE: threadBootstrap.ts
// Purpose: Pure helpers for draft reuse and thread creation payloads.
// Layer: Web bootstrap/domain helpers
// Exports: draft patching, reuse checks, and thread creation state resolution.

import {
  DEFAULT_RUNTIME_MODE,
  type ModelSelection,
  type OrchestrationThreadPullRequest,
  type ProjectId,
  type ProviderInteractionMode,
  type ProviderKind,
  type RuntimeMode,
  type ThreadEnvironmentMode,
  type ThreadId,
} from "@glade/contracts";
import {
  type ComposerThreadDraftState,
  type DraftThreadEnvMode,
  type DraftThreadState,
  resolvePreferredComposerModelSelection,
} from "../composerDraftStore";
import { DEFAULT_INTERACTION_MODE } from "../types";

export interface NewThreadOptions {
  branch?: string | null;
  worktreePath?: string | null;
  workingDirectory?: string | null;
  envMode?: DraftThreadEnvMode;
  provider?: ProviderKind;
  fresh?: boolean;
  /** Keep a draft outside the project's single reusable draft slot. */
  standalone?: boolean;
}

interface ActiveThreadSnapshot {
  projectId: ProjectId;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  envMode?: ThreadEnvironmentMode | undefined;
  lastKnownPr?: OrchestrationThreadPullRequest | null;
}

export interface DraftReusePlanStored {
  draftThread: DraftThreadState;
  kind: "stored";
  threadId: ThreadId;
}

export interface DraftReusePlanRoute {
  draftThread: DraftThreadState;
  kind: "route";
  threadId: ThreadId;
}

export interface DraftReusePlanFresh {
  kind: "fresh";
}

export type ThreadBootstrapPlan = DraftReusePlanStored | DraftReusePlanRoute | DraftReusePlanFresh;

interface ResolveThreadCreationStateInput {
  activeDraftThread: DraftThreadState | null;
  activeThread: ActiveThreadSnapshot | null;
  defaultProvider?: ProviderKind | null | undefined;
  draftComposerState: ComposerThreadDraftState | null;
  draftThread: DraftThreadState | null;
  options: NewThreadOptions | undefined;
  projectDefaultModelSelection: ModelSelection | null;
  projectId: ProjectId;
}

export interface ThreadCreationState {
  branch: string | null;
  envMode: DraftThreadEnvMode;
  interactionMode: ProviderInteractionMode;
  lastKnownPr: OrchestrationThreadPullRequest | null;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  worktreePath: string | null;
  workingDirectory: string | null;
}

// Decide whether we should reuse a stored draft, the current route draft, or create a fresh one.
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

// Build the initial draft-thread metadata for a brand new thread bootstrap.
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

// Detect whether the caller wants to override stored draft context before reuse.
function hasDraftContextOverrides(options?: NewThreadOptions): boolean {
  return (
    options?.branch !== undefined ||
    options?.worktreePath !== undefined ||
    options?.workingDirectory !== undefined ||
    options?.envMode !== undefined
  );
}

// Build the exact patch we should apply to an existing draft before reusing it.
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

// Reuse only when the active route draft already belongs to the target project.
export function shouldReuseActiveDraftThread(input: {
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

// Resolve the durable thread payload for a promoted draft from the most specific state.
export function resolveThreadCreationState(
  input: ResolveThreadCreationStateInput,
): ThreadCreationState {
  const hasExplicitEnvModeOverride =
    input.options !== undefined && Object.hasOwn(input.options, "envMode");
  const explicitEnvMode: DraftThreadEnvMode | undefined = hasExplicitEnvModeOverride
    ? (input.options?.envMode ?? "local")
    : undefined;
  const inheritedEnvMode =
    input.draftThread?.envMode !== undefined
      ? input.draftThread.envMode
      : input.activeThread?.projectId === input.projectId
        ? input.activeThread.envMode
        : input.activeDraftThread?.projectId === input.projectId
          ? input.activeDraftThread.envMode
          : undefined;

  return {
    modelSelection: resolvePreferredComposerModelSelection({
      draft: input.draftComposerState,
      threadModelSelection:
        input.activeThread?.projectId === input.projectId
          ? input.activeThread.modelSelection
          : null,
      projectModelSelection: input.projectDefaultModelSelection,
      defaultProvider: input.defaultProvider,
    }),
    runtimeMode:
      input.draftThread?.runtimeMode ??
      (input.activeThread?.projectId === input.projectId ? input.activeThread.runtimeMode : null) ??
      (input.activeDraftThread?.projectId === input.projectId
        ? input.activeDraftThread.runtimeMode
        : null) ??
      DEFAULT_RUNTIME_MODE,
    interactionMode:
      // Plan mode is an explicit composer/thread choice. Do not copy it from
      // the previously active thread into a fresh session bootstrap.
      input.draftThread?.interactionMode ?? DEFAULT_INTERACTION_MODE,
    lastKnownPr:
      input.draftThread?.lastKnownPr ??
      (input.activeThread?.projectId === input.projectId ? input.activeThread.lastKnownPr : null) ??
      (input.activeDraftThread?.projectId === input.projectId
        ? input.activeDraftThread.lastKnownPr
        : null) ??
      null,
    envMode: hasExplicitEnvModeOverride
      ? (explicitEnvMode ?? "local")
      : (inheritedEnvMode ?? "local"),
    branch:
      input.options?.branch !== undefined
        ? (input.options.branch ?? null)
        : (input.draftThread?.branch ?? null),
    worktreePath: (() => {
      if (input.options?.worktreePath !== undefined) {
        return input.options.worktreePath ?? null;
      }
      if (explicitEnvMode === "local") {
        return null;
      }
      return input.draftThread?.worktreePath ?? null;
    })(),
    workingDirectory:
      input.options?.workingDirectory !== undefined
        ? (input.options.workingDirectory ?? null)
        : (input.draftThread?.workingDirectory ?? null),
  };
}
