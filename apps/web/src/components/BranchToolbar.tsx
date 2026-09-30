import type { ProviderKind, ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ProviderModelDescriptor } from "@glade/contracts/provider/providerDiscovery";
import type { ServerProviderStatus } from "@glade/contracts/server/server";
import type { RuntimeMode } from "@glade/contracts/provider/sessionPolicy";
import { ChevronDownIcon, WorktreeIcon } from "~/lib/icons";
import { HiOutlineHandRaised } from "react-icons/hi2";
import { CentralIcon } from "~/lib/central-icons";
import { useCallback, useMemo, type ReactNode } from "react";

import { newCommandId, cn } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useComposerDraftStore } from "../composerDraftStore";
import { resolveThreadEnvironmentPresentation } from "../lib/threadEnvironment";
import {
  RUNTIME_MODE_PRESENTATION,
  providerModelSupportsAutoRuntimeMode,
} from "../lib/runtimeMode";
import { useStore } from "../store";
import { createProjectSelector, createThreadSelector } from "../storeSelectors";
import {
  EnvMode,
  resolveAssociatedWorktreeMetadataAfterWorkspacePatch,
  resolveDraftEnvModeAfterBranchChange,
  resolveEffectiveEnvMode,
} from "./BranchToolbar.logic";
import {
  BranchToolbarBranchSelector,
  type BranchSelectorVariant,
} from "./BranchToolbarBranchSelector";
import {
  RUNTIME_AUTO_ACCENT_CLASS_NAME,
  RUNTIME_FULL_ACCESS_ACCENT_CLASS_NAME,
  COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME,
} from "./chat/composerPickerStyles";
import {
  ENVIRONMENT_ROW_CLASS_NAME,
  ENVIRONMENT_ROW_ICON_CLASS_NAME,
  EnvironmentRowBody,
} from "./chat/environment/EnvironmentRow";
import type { ContextWindowSnapshot } from "../lib/contextWindow";
import { ComposerPickerMenuPopup } from "./chat/ComposerPickerMenuPopup";
import { ComposerEnvironmentPicker } from "./chat/ComposerEnvironmentPicker";
import { Button } from "./ui/button";
import { Menu, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./ui/menu";
import type { ThreadWorkspacePatch } from "../types";

function WorktreeGlyph({ className }: { className?: string }) {
  return <WorktreeIcon className={className} />;
}

function RuntimeModeMenuItem({
  mode,
  icon,
  accent = false,
}: {
  mode: RuntimeMode;
  icon: ReactNode;
  accent?: boolean;
}) {
  const presentation = RUNTIME_MODE_PRESENTATION[mode];
  return (
    <MenuRadioItem
      value={mode}
      className={cn(
        "runtime-mode-menu-item",
        mode === "auto" && "runtime-mode-menu-item--auto",
        accent &&
          "text-[var(--runtime-full-access-accent)] data-highlighted:text-[var(--runtime-full-access-accent)]",
      )}
    >
      <span className="grid w-full min-w-0 flex-1 grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-3">
        <span className="flex h-5 items-center justify-center">{icon}</span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span>{presentation.label}</span>
          <span
            className={cn(
              "runtime-mode-menu-description text-ui leading-snug font-normal",
              accent ? "text-current" : "text-muted-foreground",
            )}
          >
            {presentation.description}
          </span>
        </span>
      </span>
    </MenuRadioItem>
  );
}

export interface BranchToolbarProps {
  threadId: ThreadId;
  className?: string;
  onEnvModeChange: (mode: EnvMode) => void;
  envLocked: boolean;
  threadDetailReady: boolean;
  onHandoffToLocal?: () => void;
  handoffBusy?: boolean;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest?: () => void;

  variant?: BranchSelectorVariant;

  showBranchSelector?: boolean;
  showEnvironment?: boolean;
}

export interface RuntimeUsageControlsProps {
  provider?: ProviderKind | undefined;
  runtimeModel?: ProviderModelDescriptor | undefined;
  providerStatus?: ServerProviderStatus | null | undefined;
  runtimeMode?: RuntimeMode | undefined;
  onRuntimeModeChange?: ((mode: RuntimeMode) => void) | undefined;
  contextWindow?: ContextWindowSnapshot | null | undefined;
  cumulativeCostUsd?: number | null | undefined;
  activeContextWindowLabel?: string | null | undefined;
  pendingContextWindowLabel?: string | null | undefined;
  className?: string | undefined;

  hideLabel?: boolean | undefined;
}

export function RuntimeUsageControls({
  provider,
  runtimeModel,
  providerStatus,
  runtimeMode,
  onRuntimeModeChange,
  className,
  hideLabel: hideLabelProp,
}: RuntimeUsageControlsProps) {
  const autoModeAvailable =
    provider !== undefined &&
    providerModelSupportsAutoRuntimeMode(provider, runtimeModel, providerStatus);
  const runtimePresentation = RUNTIME_MODE_PRESENTATION[runtimeMode ?? "approval-required"];
  const hideLabel = hideLabelProp ?? false;
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-[var(--color-text-foreground-secondary)]",
        className,
      )}
    >
      {runtimeMode && onRuntimeModeChange ? (
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="sm"
                variant="chrome"
                className={cn(
                  "min-w-0 shrink-0 justify-start gap-1.5 whitespace-nowrap px-2 [&_svg]:mx-0 sm:px-2.5",
                  COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME,
                  runtimeMode === "auto" && RUNTIME_AUTO_ACCENT_CLASS_NAME,
                  runtimeMode === "full-access" && RUNTIME_FULL_ACCESS_ACCENT_CLASS_NAME,
                )}
                title={`${runtimePresentation.label}: ${runtimePresentation.description}. Click to change permissions.`}
              />
            }
          >
            <span className="inline-flex items-center gap-1.5">
              {runtimeMode === "full-access" ? (
                <CentralIcon name="shield-access" className="size-3.5 shrink-0" />
              ) : runtimeMode === "auto" ? (
                <CentralIcon name="shield-code" className="size-3.5 shrink-0" />
              ) : (
                <HiOutlineHandRaised className="size-3.5 shrink-0" />
              )}
              <span className={cn("truncate", hideLabel ? "sr-only" : "@max-[480px]:sr-only")}>
                {runtimePresentation.label}
              </span>
              <ChevronDownIcon
                className={cn(
                  "size-3 shrink-0 opacity-70",
                  hideLabel ? "hidden" : "@max-[480px]:hidden",
                )}
              />
            </span>
          </MenuTrigger>
          <ComposerPickerMenuPopup
            align="start"
            side="top"
            className="runtime-mode-menu w-[26rem] min-w-[26rem]"
          >
            <MenuRadioGroup
              className="flex flex-col gap-1"
              value={runtimeMode}
              onValueChange={(value) => {
                if (
                  !value ||
                  (value !== "full-access" && value !== "auto" && value !== "approval-required") ||
                  (value === "auto" && !autoModeAvailable) ||
                  value === runtimeMode
                ) {
                  return;
                }
                onRuntimeModeChange(value);
              }}
            >
              <RuntimeModeMenuItem
                mode="approval-required"
                icon={<HiOutlineHandRaised className="size-4 shrink-0" />}
              />
              {autoModeAvailable ? (
                <RuntimeModeMenuItem
                  mode="auto"
                  icon={<CentralIcon name="shield-code" className="size-4 shrink-0" />}
                />
              ) : null}
              <RuntimeModeMenuItem
                mode="full-access"
                accent
                icon={<CentralIcon name="shield-access" className="size-4 shrink-0" />}
              />
            </MenuRadioGroup>
          </ComposerPickerMenuPopup>
        </Menu>
      ) : null}
    </div>
  );
}

export default function BranchToolbar({
  threadId,
  className,
  onEnvModeChange,
  envLocked,
  threadDetailReady,
  onHandoffToLocal,
  handoffBusy: handoffBusyProp,
  onCheckoutPullRequestRequest,
  onComposerFocusRequest,
  variant: variantProp,
  showBranchSelector: showBranchSelectorProp,
  showEnvironment = true,
}: BranchToolbarProps) {
  const handoffBusy = handoffBusyProp ?? false;
  const variant = variantProp ?? "toolbar";
  const showBranchSelector = showBranchSelectorProp ?? true;
  const isPanel = variant === "panel";
  const setThreadWorkspaceAction = useStore((store) => store.setThreadWorkspace);
  const draftThread = useComposerDraftStore((store) => store.getDraftThread(threadId));
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const serverThread = useStore(useMemo(() => createThreadSelector(threadId), [threadId]));
  const activeProjectId = serverThread?.projectId ?? draftThread?.projectId ?? null;
  const activeProject = useStore(
    useMemo(() => createProjectSelector(activeProjectId), [activeProjectId]),
  );
  const hasServerThread = serverThread !== undefined;
  const activeThreadId = serverThread?.id ?? (draftThread ? threadId : undefined);
  const activeThreadBranch = hasServerThread
    ? (serverThread.branch ?? null)
    : (draftThread?.branch ?? null);
  const activeWorktreePath = hasServerThread
    ? (serverThread.worktreePath ?? null)
    : (draftThread?.worktreePath ?? null);
  const activeWorkingDirectory = hasServerThread
    ? (serverThread.workingDirectory ?? null)
    : (draftThread?.workingDirectory ?? null);
  const branchCwd = activeWorktreePath ?? activeWorkingDirectory ?? activeProject?.cwd ?? null;
  const branchProjectCwd = activeProject?.cwd ?? null;
  const effectiveEnvMode = resolveEffectiveEnvMode({
    activeWorktreePath,
    hasServerThread,
    draftThreadEnvMode: draftThread?.envMode,
    serverThreadEnvMode: serverThread?.envMode,
  });
  const environmentPresentation = resolveThreadEnvironmentPresentation({
    envMode: effectiveEnvMode,
    worktreePath: activeWorktreePath,
  });

  const setThreadWorkspace = useCallback(
    (patch: ThreadWorkspacePatch) => {
      if (!activeThreadId) return;
      const branch = patch.branch !== undefined ? patch.branch : activeThreadBranch;
      const worktreePath =
        patch.worktreePath !== undefined ? patch.worktreePath : activeWorktreePath;
      const nextEnvMode =
        patch.envMode !== undefined ? patch.envMode : worktreePath ? "worktree" : effectiveEnvMode;
      const nextAssociatedWorktree = resolveAssociatedWorktreeMetadataAfterWorkspacePatch({
        branch,
        worktreePath,
        existingAssociatedWorktreePath: serverThread?.associatedWorktreePath ?? null,
        existingAssociatedWorktreeBranch: serverThread?.associatedWorktreeBranch ?? null,
        existingAssociatedWorktreeRef: serverThread?.associatedWorktreeRef ?? null,
        ...(patch.associatedWorktreePath !== undefined
          ? { patchAssociatedWorktreePath: patch.associatedWorktreePath }
          : {}),
        ...(patch.associatedWorktreeBranch !== undefined
          ? { patchAssociatedWorktreeBranch: patch.associatedWorktreeBranch }
          : {}),
        ...(patch.associatedWorktreeRef !== undefined
          ? { patchAssociatedWorktreeRef: patch.associatedWorktreeRef }
          : {}),
      });
      const api = readNativeApi();

      if (serverThread?.session && worktreePath !== activeWorktreePath && api) {
        void api.orchestration
          .dispatchCommand({
            type: "thread.session.stop",
            commandId: newCommandId(),
            threadId: activeThreadId,
            createdAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }
      if (api && hasServerThread) {
        void api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: activeThreadId,
          envMode: nextEnvMode,
          branch,
          worktreePath,
          associatedWorktreePath: nextAssociatedWorktree.associatedWorktreePath,
          associatedWorktreeBranch: nextAssociatedWorktree.associatedWorktreeBranch,
          associatedWorktreeRef: nextAssociatedWorktree.associatedWorktreeRef,
        });
      }
      if (hasServerThread) {
        setThreadWorkspaceAction(activeThreadId, {
          envMode: nextEnvMode,
          branch,
          worktreePath,
          ...nextAssociatedWorktree,
        });
        return;
      }
      const nextDraftEnvMode = resolveDraftEnvModeAfterBranchChange({
        nextWorktreePath: worktreePath,
        currentWorktreePath: activeWorktreePath,
        effectiveEnvMode,
      });
      setDraftThreadContext(threadId, {
        branch,
        worktreePath,
        envMode: nextDraftEnvMode,
      });
    },
    [
      activeThreadId,
      activeThreadBranch,
      serverThread?.session,
      activeWorktreePath,
      hasServerThread,
      setThreadWorkspaceAction,
      serverThread?.associatedWorktreePath,
      serverThread?.associatedWorktreeBranch,
      serverThread?.associatedWorktreeRef,
      setDraftThreadContext,
      threadId,
      effectiveEnvMode,
    ],
  );

  const canHandoffToLocal = Boolean(hasServerThread && activeWorktreePath);
  const canSwitchToWorktree = Boolean(
    !envLocked && !activeWorktreePath && effectiveEnvMode === "local",
  );
  const canSwitchToLocal = Boolean(!envLocked && effectiveEnvMode === "worktree");
  const showEnvPicker = effectiveEnvMode === "local" || canSwitchToLocal;

  if (!activeThreadId || !activeProject) return null;

  return (
    <div
      className={cn(
        isPanel
          ? "flex w-full flex-col gap-0.5"
          : "mx-auto flex w-full items-center justify-between px-3 pb-1.5 pt-1",
        className,
      )}
    >
      <div className={isPanel ? "flex flex-col gap-0.5" : "flex min-w-0 items-center gap-2"}>
        {showEnvironment ? (
          showEnvPicker ? (
            <ComposerEnvironmentPicker
              environmentPresentation={environmentPresentation}
              onEnvModeChange={onEnvModeChange}
              canSwitchToWorktree={canSwitchToWorktree}
              canHandoffToLocal={canHandoffToLocal}
              onHandoffToLocal={onHandoffToLocal}
              handoffBusy={handoffBusy}
              isPanel={isPanel}
            />
          ) : isPanel ? (
            <div className={cn(ENVIRONMENT_ROW_CLASS_NAME, "cursor-default hover:bg-transparent")}>
              <EnvironmentRowBody
                icon={<WorktreeGlyph className={ENVIRONMENT_ROW_ICON_CLASS_NAME} />}
                label={environmentPresentation.shortLabel}
              />
            </div>
          ) : (
            <span className="inline-flex items-center gap-2 px-1.5 text-ui-sm font-normal text-[var(--color-text-foreground-secondary)]">
              <WorktreeGlyph className="size-3.5" />
              {environmentPresentation.shortLabel}
            </span>
          )
        ) : null}

        {showBranchSelector ? (
          // ChatView stays mounted while the route switches threads. Reset the selector's optimistic checkout
          // state at that boundary so a previous thread cannot paint its branch while the new thread's
          // workspace query is resolving.
          <BranchToolbarBranchSelector
            key={threadId}
            workspace={{
              activeProjectCwd: branchProjectCwd ?? activeProject.cwd,
              activeThreadBranch,
              activeWorktreePath,
              branchCwd,
              effectiveEnvMode,
            }}
            thread={{
              envLocked,
              hasServerThread,
              isThreadSettled: serverThread?.settledAt != null || !threadDetailReady,
            }}
            actions={{
              onSetThreadWorkspace: setThreadWorkspace,
              ...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {}),
              ...(onComposerFocusRequest ? { onComposerFocusRequest } : {}),
            }}
            variant={variant}
          />
        ) : null}
      </div>
    </div>
  );
}
