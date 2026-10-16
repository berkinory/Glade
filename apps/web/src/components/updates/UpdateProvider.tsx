import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { SearchIcon } from "~/lib/icons";
import { toastManager } from "../ui/toast";
import { useDesktopUpdate, type DesktopUpdateControls } from "./useDesktopUpdate";
import {
  groupByMachine,
  usePendingProviderUpdates,
  type ProviderUpdateItem,
} from "./usePendingProviderUpdates";
import { UpdatesDialog, type UpdateSelection } from "./UpdatesDialog";
import { useUpdateRun, type UpdateFailure } from "./useUpdateRun";

export interface UpdateControls {
  readonly desktopUpdate: DesktopUpdateControls;
  readonly pill: {
    readonly busy: boolean;
    readonly label: string;
    readonly downloadPercent: number | null;
    readonly tooltip: string;
  } | null;
  readonly openUpdates: () => void;
}

const UpdateContext = createContext<UpdateControls | null>(null);
const listFormat = new Intl.ListFormat("en", { type: "conjunction" });

function isAppUpdateReady(desktop: DesktopUpdateControls): boolean {
  return (
    desktop.showDesktopUpdateButton &&
    desktop.desktopUpdateButtonAction === "install" &&
    !desktop.desktopUpdateButtonDisabled
  );
}

function describePending(providers: ReadonlyArray<ProviderUpdateItem>, appVersion: string | null) {
  const parts = groupByMachine(providers).map(
    ({ machineLabel, items }) =>
      `${listFormat.format(items.map((item) => PROVIDER_DISPLAY_NAMES[item.provider.provider]))} on ${machineLabel ?? "this computer"}`,
  );
  if (appVersion !== null) parts.unshift(`Glade ${appVersion}`.trim());
  return `Updates for ${parts.join(", ")}.`;
}

function failureToastDescription(failures: ReadonlyArray<UpdateFailure>) {
  return failures
    .map(
      ({ item, reason }) =>
        `${PROVIDER_DISPLAY_NAMES[item.provider.provider]}${item.machineLabel ? ` on ${item.machineLabel}` : ""}: ${reason}`,
    )
    .join("\n");
}

export function UpdateProvider({ children }: { children: ReactNode }) {
  const desktopUpdate = useDesktopUpdate();
  const providerItems = usePendingProviderUpdates();
  const { run, start, clear } = useUpdateRun();
  const [dialogOpen, setDialogOpen] = useState(false);
  // Read after an await: a run that finishes while the dialog is closed reports through a toast.
  const dialogOpenRef = useRef(false);

  const openUpdates = useCallback(() => {
    dialogOpenRef.current = true;
    setDialogOpen(true);
  }, []);
  const changeDialogOpen = (open: boolean) => {
    if (open) return openUpdates();
    dialogOpenRef.current = false;
    setDialogOpen(false);
    if (run?.finished) clear();
  };

  const update = async ({ providers, restart }: UpdateSelection) => {
    const failures = providers.length > 0 ? await start(providers, restart) : [];
    if (failures.length === 0 && restart) {
      desktopUpdate.handleDesktopUpdateButtonClick();
      return;
    }
    if (dialogOpenRef.current) return;
    if (failures.length === 0) {
      clear();
      toastManager.add({
        type: "success",
        title: providers.length === 1 ? "Provider updated" : "Providers updated",
        description: "New chats use the updated providers.",
        timeout: 6000,
      });
      return;
    }
    toastManager.add({
      type: "error",
      title:
        failures.length === providers.length
          ? "Provider updates failed"
          : "Some provider updates failed",
      description: failureToastDescription(failures),
      timeout: 0,
      data: {
        actions: [{ label: "Review", icon: SearchIcon, onClick: openUpdates }],
      },
    });
  };

  const appReady = isAppUpdateReady(desktopUpdate);
  const actionableProviders = providerItems.filter((item) => item.oneClick && !item.active);
  const actionable = actionableProviders.length + (appReady ? 1 : 0);
  const updating = (run !== null && !run.finished) || desktopUpdate.installing;
  const showPill = updating || actionable > 0 || desktopUpdate.showDesktopUpdateButton;
  const pillLabel = updating
    ? "Updating"
    : actionable > 1
      ? `${actionable} updates`
      : actionable === 1
        ? "Update"
        : desktopUpdate.desktopUpdateButtonPresentation.label;
  const pillTooltip = updating
    ? desktopUpdate.installing
      ? "Restarting Glade to update."
      : "Updating providers."
    : actionable > 0
      ? describePending(
          actionableProviders,
          appReady ? desktopUpdate.desktopUpdateReadyVersion : null,
        )
      : desktopUpdate.desktopUpdateTooltip;
  const downloadPercent = desktopUpdate.desktopUpdateDownloadPercent;
  const value = useMemo<UpdateControls>(
    () => ({
      desktopUpdate,
      pill: showPill
        ? { busy: updating, label: pillLabel, downloadPercent, tooltip: pillTooltip }
        : null,
      openUpdates,
    }),
    [desktopUpdate, showPill, updating, pillLabel, downloadPercent, pillTooltip, openUpdates],
  );

  return (
    <UpdateContext value={value}>
      {children}
      <UpdatesDialog
        open={dialogOpen}
        onOpenChange={changeDialogOpen}
        desktopUpdate={desktopUpdate}
        appReady={appReady}
        providerItems={run?.items ?? providerItems}
        run={run}
        onUpdate={(selection) => void update(selection)}
      />
    </UpdateContext>
  );
}

export function useUpdates(): UpdateControls {
  const context = useContext(UpdateContext);
  if (!context) throw new Error("useUpdates requires UpdateProvider");
  return context;
}
