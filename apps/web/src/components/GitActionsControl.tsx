import { ChevronDownIcon } from "~/lib/icons";
import { ComposerPickerMenuPopup } from "~/components/chat/ComposerPickerMenuPopup";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Menu, MenuGroup, MenuGroupLabel, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { cn } from "~/lib/utils";
import {
  CHAT_HEADER_CONTROL_CLASS_NAME,
  CHAT_HEADER_ICON_CONTROL_CLASS_NAME,
  CHAT_HEADER_ICON_STRENGTH_CLASS_NAME,
  CHAT_HEADER_SPLIT_LEADING_CLASS_NAME,
  CHAT_HEADER_SPLIT_TRAILING_CLASS_NAME,
  ChatHeaderButton,
  ChatHeaderSplitDivider,
  ChatHeaderSplitGroup,
} from "./chat/chatHeaderControls";
import {
  ENVIRONMENT_ROW_CLASS_NAME,
  ENVIRONMENT_ROW_ICON_CLASS_NAME,
  EnvironmentRow,
  EnvironmentRowBody,
  EnvironmentRowChevron,
} from "./chat/environment/EnvironmentRow";
import { GitActionGlyph } from "./gitActionGlyphs";
import { type GitGlyphName } from "./GitActionsControl.logic";
import { GitCommitDialog } from "./GitCommitDialog";
import { GitCreatePrDialog } from "./GitCreatePrDialog";
import {
  GitPickerMenuRow,
  GitQuickActionIcon,
  findRunnableCommitPushMenuItem,
  type GitActionsControlProps,
} from "./gitActionsControlModel";
import { useGitActionsControl } from "./useGitActionsControl";
export default function GitActionsControl(props: GitActionsControlProps) {
  const model = useGitActionsControl(props);
  if (!model) return null;
  const {
    visibleWhen,
    promotedPull,
    hideQuickActionLabel,
    isGitActionRunning,
    runSyncWithRemote,
    gitActionMenuItems,
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
    handleCreatePrDialogBrowser,
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
    setCreateBranchName,
    createBranchName,
    createBranchNameConflicts,
    createBranchNameFieldId,
    createAndCheckoutBranch,
    isPanel,
    showPromotedPullAction,
    openDialogForMenuItem,
    requestGitActionAvailabilityRefresh,
    isRepo,
    initMutation,
    quickActionDisabledReason,
    quickAction,
    runQuickAction,
  } = model;
  if (visibleWhen === "pull-available") {
    if (!promotedPull) return null;
    // Pull-only chrome: Environment already owns commit/push/PR dialogs, so this instance must not
    // mount a second copy of them beside the panel control.
    return (
      <ChatHeaderButton
        type="button"
        tone="outline"
        className={hideQuickActionLabel ? "gap-1" : "gap-1.5"}
        aria-label={promotedPull.label}
        title={promotedPull.label}
        disabled={isGitActionRunning}
        onClick={runSyncWithRemote}
      >
        <GitActionGlyph name="sync" />
        {!hideQuickActionLabel ? (
          <span className="truncate font-normal">{promotedPull.label}</span>
        ) : null}
      </ChatHeaderButton>
    );
  }
  const runnableCommitPushMenuItem = findRunnableCommitPushMenuItem(gitActionMenuItems);
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
        onOpenInBrowser={handleCreatePrDialogBrowser}
      />

      <GitCommitDialog
        open={isCommitDialogOpen}
        onOpenChange={(open) => {
          if (!open) setIsCommitDialogOpen(false);
        }}
        context={commitDialogContext}
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
              Abort
            </Button>
            <Button size="sm" onClick={continuePendingDefaultBranchAction}>
              {pendingDefaultBranchActionCopy?.continueLabel ?? "Continue"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog
        open={isCreateBranchDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsCreateBranchDialogOpen(false);
            setCreateBranchName("");
          }
        }}
      >
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Branch</DialogTitle>
            <DialogDescription>
              Create and switch to a branch from the current HEAD. Future commits, pushes, and PRs
              will use it.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-3">
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                const trimmedName = createBranchName.trim();
                if (!trimmedName || createBranchNameConflicts) {
                  return;
                }
                void createAndCheckoutBranch(trimmedName);
              }}
            >
              <div className="space-y-1.5">
                <label
                  className="block font-medium text-ui leading-snug"
                  htmlFor={createBranchNameFieldId}
                >
                  Branch name
                </label>
                <Input
                  autoFocus
                  id={createBranchNameFieldId}
                  placeholder="feature/my-change"
                  value={createBranchName}
                  onChange={(event) => setCreateBranchName(event.target.value)}
                />
              </div>
              {createBranchNameConflicts ? (
                <p className="text-destructive text-ui leading-snug">
                  A branch with this name already exists.
                </p>
              ) : null}
              <DialogFooter variant="bare">
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => {
                    setIsCreateBranchDialogOpen(false);
                    setCreateBranchName("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={createBranchName.trim().length === 0 || createBranchNameConflicts}
                >
                  Create Branch
                </Button>
              </DialogFooter>
            </form>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
  if (isPanel) {
    const showPanelPullRow = showPromotedPullAction;
    const panelPrimaryLabel = showPanelPullRow
      ? (promotedPull?.label ?? "Pull")
      : (runnableCommitPushMenuItem?.label ?? "Commit and Push");
    const panelPrimaryGlyph: GitGlyphName = showPanelPullRow ? "sync" : "push";
    const runPanelPrimaryAction = () => {
      if (showPanelPullRow) {
        runSyncWithRemote();
        return;
      }
      if (runnableCommitPushMenuItem) {
        openDialogForMenuItem(runnableCommitPushMenuItem);
      }
    };
    const panelGitActionsMenu = (
      <Menu
        onOpenChange={(open) => {
          if (open) requestGitActionAvailabilityRefresh();
        }}
      >
        <MenuTrigger
          render={
            <button
              type="button"
              className={cn(ENVIRONMENT_ROW_CLASS_NAME, "w-auto shrink-0 px-1.5")}
              aria-label="Git action options"
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
    );
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
          <div className="flex w-full items-center">
            <button
              type="button"
              className={cn(ENVIRONMENT_ROW_CLASS_NAME, "min-w-0 flex-1")}
              aria-label={panelPrimaryLabel}
              title={panelPrimaryLabel}
              disabled={isGitActionRunning || (!showPanelPullRow && !runnableCommitPushMenuItem)}
              onClick={runPanelPrimaryAction}
            >
              <EnvironmentRowBody
                icon={
                  <GitActionGlyph
                    name={panelPrimaryGlyph}
                    className={ENVIRONMENT_ROW_ICON_CLASS_NAME}
                  />
                }
                label={panelPrimaryLabel}
              />
            </button>
            {panelGitActionsMenu}
          </div>
        )}
        {gitActionDialogs}
      </>
    );
  }
  return (
    <>
      {!isRepo ? (
        <Button
          variant="chrome-outline"
          size="xs"
          className={cn(CHAT_HEADER_CONTROL_CLASS_NAME, CHAT_HEADER_ICON_STRENGTH_CLASS_NAME)}
          disabled={initMutation.isPending}
          onClick={() => initMutation.mutate()}
        >
          {initMutation.isPending ? "Initializing..." : "Initialize Git"}
        </Button>
      ) : (
        <ChatHeaderSplitGroup label="Git actions">
          {promotedPull ? (
            <Button
              variant="chrome-outline"
              size={hideQuickActionLabel ? "icon-xs" : "xs"}
              className={cn(
                hideQuickActionLabel
                  ? CHAT_HEADER_ICON_CONTROL_CLASS_NAME
                  : CHAT_HEADER_CONTROL_CLASS_NAME,
                CHAT_HEADER_ICON_STRENGTH_CLASS_NAME,
                CHAT_HEADER_SPLIT_LEADING_CLASS_NAME,
              )}
              disabled={isGitActionRunning}
              aria-label={promotedPull.label}
              title={promotedPull.label}
              onClick={runSyncWithRemote}
            >
              <GitActionGlyph name="sync" />
              {!hideQuickActionLabel ? (
                <span className="font-normal">{promotedPull.label}</span>
              ) : null}
            </Button>
          ) : quickActionDisabledReason ? (
            <Popover>
              <PopoverTrigger
                openOnHover
                render={
                  <Button
                    aria-label={quickAction.label}
                    aria-disabled="true"
                    className={cn(
                      hideQuickActionLabel
                        ? CHAT_HEADER_ICON_CONTROL_CLASS_NAME
                        : CHAT_HEADER_CONTROL_CLASS_NAME,
                      CHAT_HEADER_ICON_STRENGTH_CLASS_NAME,
                      CHAT_HEADER_SPLIT_LEADING_CLASS_NAME,
                      "cursor-not-allowed opacity-64",
                    )}
                    size={hideQuickActionLabel ? "icon-xs" : "xs"}
                    variant="chrome-outline"
                    title={quickAction.label}
                  />
                }
              >
                <GitQuickActionIcon quickAction={quickAction} />
                {!hideQuickActionLabel ? (
                  <span className="font-normal">{quickAction.label}</span>
                ) : null}
              </PopoverTrigger>
              <PopoverPopup tooltipStyle side="bottom" align="start">
                {quickActionDisabledReason}
              </PopoverPopup>
            </Popover>
          ) : (
            <Button
              variant="chrome-outline"
              size={hideQuickActionLabel ? "icon-xs" : "xs"}
              className={cn(
                hideQuickActionLabel
                  ? CHAT_HEADER_ICON_CONTROL_CLASS_NAME
                  : CHAT_HEADER_CONTROL_CLASS_NAME,
                CHAT_HEADER_ICON_STRENGTH_CLASS_NAME,
                CHAT_HEADER_SPLIT_LEADING_CLASS_NAME,
              )}
              disabled={isGitActionRunning || quickAction.disabled}
              aria-label={quickAction.label}
              title={quickAction.label}
              onClick={runQuickAction}
            >
              <GitQuickActionIcon quickAction={quickAction} />
              {!hideQuickActionLabel ? (
                <span className="font-normal">{quickAction.label}</span>
              ) : null}
            </Button>
          )}
          <ChatHeaderSplitDivider />
          <Menu
            onOpenChange={(open) => {
              if (open) requestGitActionAvailabilityRefresh();
            }}
          >
            <MenuTrigger
              render={
                <Button
                  aria-label="Git action options"
                  size="icon-xs"
                  variant="chrome-outline"
                  className={cn(
                    CHAT_HEADER_ICON_CONTROL_CLASS_NAME,
                    CHAT_HEADER_ICON_STRENGTH_CLASS_NAME,
                    CHAT_HEADER_SPLIT_TRAILING_CLASS_NAME,
                  )}
                />
              }
              disabled={isGitActionRunning}
            >
              <ChevronDownIcon aria-hidden="true" className="size-3.5" />
            </MenuTrigger>
            <ComposerPickerMenuPopup align="end" side="bottom" className="w-50 min-w-50">
              {gitMenuContent}
            </ComposerPickerMenuPopup>
          </Menu>
        </ChatHeaderSplitGroup>
      )}

      {gitActionDialogs}
    </>
  );
}
