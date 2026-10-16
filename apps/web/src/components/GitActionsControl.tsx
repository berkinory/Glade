import { ComposerPickerMenuPopup } from "~/components/chat/ComposerPickerMenuPopup";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Menu, MenuGroup, MenuGroupLabel, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";
import { ChatHeaderButton } from "./chat/chatHeaderControls";
import {
  ENVIRONMENT_ROW_CLASS_NAME,
  ENVIRONMENT_ROW_ICON_CLASS_NAME,
  EnvironmentRow,
  EnvironmentRowChevron,
} from "./chat/environment/EnvironmentRow";
import { GitActionGlyph } from "./gitActionGlyphs";
import { CreateBranchDialog } from "./CreateBranchDialog";
import { GitCommitDialog } from "./GitCommitDialog";
import { GitCreatePrDialog } from "./GitCreatePrDialog";
import {
  GitPickerMenuRow,
  GitQuickActionIcon,
  type GitActionsControlProps,
} from "./gitActionsControlModel";
import { useGitActionsControl } from "./useGitActionsControl";
export default function GitActionsControl(props: GitActionsControlProps) {
  const model = useGitActionsControl(props);
  if (!model) return null;
  const {
    visibleWhen,
    promotedPull,
    isGitActionRunning,
    runSyncWithRemote,
    gitPickerMenuItems,
    gitStatusForActions,
    isGitStatusOutOfSync,
    isGitStatusRefreshDelayed,
    isGitStatusFetching,
    gitStatusError,
    createPrDialog,
    setCreatePrDialog,
    createPrDialogContext,
    handleCreatePrDialogSubmit,
    isCommitDialogOpen,
    setIsCommitDialogOpen,
    commitDialogContext,
    handleCommitDialogSubmit,
    openChangedFileInEditor,
    pendingDefaultBranchAction,
    setPendingDefaultBranchAction,
    pendingDefaultBranchActionCopy,
    continuePendingDefaultBranchAction,
    isCreateBranchDialogOpen,
    setIsCreateBranchDialogOpen,
    suggestedCreateBranchName,
    isCreateBranchNameTaken,
    currentBranchName,
    createAndCheckoutBranch,
    requestGitActionAvailabilityRefresh,
    isRepo,
    initMutation,
    quickActionDisabledReason,
    quickAction,
    quickActionContext,
    runQuickAction,
    commitDialogPrimary,
    publishDialog,
    isPublishPending,
    gitCwd,
    actionProgress,
  } = model;
  if (visibleWhen === "pull-available") {
    if (!promotedPull) return null;
    // Pull-only chrome: Environment already owns commit/push/PR dialogs, so this instance must not
    // mount a second copy of them beside the panel control.
    return (
      <ChatHeaderButton
        type="button"
        tone="outline"
        className="gap-1.5"
        aria-label={promotedPull.label}
        title={promotedPull.label}
        disabled={isGitActionRunning}
        onClick={runSyncWithRemote}
      >
        <GitActionGlyph name="sync" />
        <span className="truncate font-normal">{promotedPull.label}</span>
      </ChatHeaderButton>
    );
  }
  const gitMenuContent = (
    <>
      <MenuGroup>
        <MenuGroupLabel>Git actions</MenuGroupLabel>
        {gitPickerMenuItems.map((item) => {
          const menuRow = <GitPickerMenuRow item={item} />;
          if (item.disabled && item.disabledReason) {
            return (
              <Popover key={item.id}>
                <PopoverTrigger
                  openOnHover
                  nativeButton={false}
                  render={<span className="block cursor-not-allowed" />}
                >
                  {menuRow}
                </PopoverTrigger>
                <PopoverPopup tooltipStyle side="left" align="center">
                  {item.disabledReason}
                </PopoverPopup>
              </Popover>
            );
          }
          return <GitPickerMenuRow key={item.id} item={item} />;
        })}
      </MenuGroup>
      {(gitStatusForActions?.branch === null ||
        (gitStatusForActions &&
          gitStatusForActions.branch !== null &&
          !gitStatusForActions.hasWorkingTreeChanges &&
          gitStatusForActions.behindCount > 0 &&
          gitStatusForActions.aheadCount === 0) ||
        isGitStatusOutOfSync ||
        gitStatusError) && <MenuSeparator className="mx-3 mt-2" />}
      {gitStatusForActions?.branch === null && (
        <p className="px-3 py-1.5 text-ui leading-snug text-warning">
          Detached HEAD: create and checkout a branch to enable push and PR actions.
        </p>
      )}
      {gitStatusForActions &&
        gitStatusForActions.branch !== null &&
        !gitStatusForActions.hasWorkingTreeChanges &&
        gitStatusForActions.behindCount > 0 &&
        gitStatusForActions.aheadCount === 0 && (
          <p className="px-3 py-1.5 text-ui leading-snug text-warning">
            Behind upstream. Pull/rebase first.
          </p>
        )}
      {isGitStatusOutOfSync && (
        <p className="px-3 py-1.5 text-ui leading-snug text-muted-foreground">
          Refreshing git status...
        </p>
      )}
      {isGitStatusRefreshDelayed && !isGitStatusOutOfSync && (
        <p className="px-3 py-1.5 text-ui leading-snug text-muted-foreground">
          {isGitStatusFetching ? "Refreshing git status..." : "Git status refresh delayed."}
        </p>
      )}
      {gitStatusError && !isGitStatusRefreshDelayed && (
        <p className="px-3 py-1.5 text-ui leading-snug text-destructive">
          {gitStatusError instanceof Error ? gitStatusError.message : "Git status refresh failed."}
        </p>
      )}
    </>
  );
  const gitActionDialogs = (
    <>
      <GitCreatePrDialog
        open={createPrDialog !== null}
        onOpenChange={(open) => {
          if (!open) setCreatePrDialog(null);
        }}
        context={createPrDialogContext}
        onSubmit={handleCreatePrDialogSubmit}
      />

      <GitCommitDialog
        open={isCommitDialogOpen}
        onOpenChange={(open) => {
          if (!open) setIsCommitDialogOpen(false);
        }}
        context={commitDialogContext}
        gitCwd={gitCwd}
        primaryActionId={commitDialogPrimary}
        onSubmit={handleCommitDialogSubmit}
        onOpenFile={openChangedFileInEditor}
      />

      <Dialog
        open={pendingDefaultBranchAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDefaultBranchAction(null);
          }
        }}
      >
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingDefaultBranchActionCopy?.title ?? "Run action on default branch?"}
            </DialogTitle>
            <DialogDescription>{pendingDefaultBranchActionCopy?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPendingDefaultBranchAction(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={continuePendingDefaultBranchAction}>
              {pendingDefaultBranchActionCopy?.continueLabel ?? "Continue"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <CreateBranchDialog
        open={isCreateBranchDialogOpen}
        onOpenChange={setIsCreateBranchDialogOpen}
        baseLabel={currentBranchName ?? "the current HEAD"}
        initialName={suggestedCreateBranchName}
        isNameTaken={isCreateBranchNameTaken}
        onCreate={(name) => void createAndCheckoutBranch(name)}
      />
    </>
  );
  const quickActionUnavailable = quickAction.disabled || isPublishPending;
  const primaryLabel =
    actionProgress?.title ?? (isGitActionRunning ? "Running Git action…" : quickAction.label);
  const primaryDetail = actionProgress
    ? actionProgress.detail
    : (quickActionDisabledReason ?? quickActionContext);
  return (
    <>
      {!isRepo ? (
        <EnvironmentRow
          icon={<GitActionGlyph name="branch" className={ENVIRONMENT_ROW_ICON_CLASS_NAME} />}
          label={initMutation.isPending ? "Initializing..." : "Initialize Git"}
          disabled={initMutation.isPending}
          onClick={() => initMutation.mutate()}
        />
      ) : (
        <div className="flex w-full items-start">
          <button
            type="button"
            className={cn(
              ENVIRONMENT_ROW_CLASS_NAME,
              "min-w-0 flex-1 items-start",
              quickActionUnavailable && "cursor-default",
            )}
            aria-label={primaryLabel}
            aria-disabled={quickActionUnavailable || undefined}
            disabled={isGitActionRunning}
            onClick={quickActionUnavailable ? undefined : runQuickAction}
          >
            <span className="flex h-[1.5em] size-[1.143em] shrink-0 items-center justify-center [&>svg]:size-full">
              {isGitActionRunning || isPublishPending ? (
                <Spinner variant="action" className={ENVIRONMENT_ROW_ICON_CLASS_NAME} />
              ) : (
                <GitQuickActionIcon quickAction={quickAction} />
              )}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={cn("truncate", quickActionUnavailable && "text-muted-foreground")}>
                {primaryLabel}
              </span>
              {primaryDetail ? (
                <span className="truncate text-ui-xs text-muted-foreground">{primaryDetail}</span>
              ) : null}
            </span>
          </button>
          <Menu
            onOpenChange={(open) => {
              if (open) requestGitActionAvailabilityRefresh();
            }}
          >
            <MenuTrigger
              render={
                <button
                  type="button"
                  className={cn(ENVIRONMENT_ROW_CLASS_NAME, "w-auto shrink-0 self-stretch px-1.5")}
                  aria-label="More Git actions"
                  title="More Git actions"
                />
              }
            >
              <EnvironmentRowChevron />
            </MenuTrigger>
            <ComposerPickerMenuPopup align="start" side="bottom" className="w-60 min-w-60">
              {gitMenuContent}
            </ComposerPickerMenuPopup>
          </Menu>
        </div>
      )}
      {gitActionDialogs}
      {publishDialog}
    </>
  );
}
