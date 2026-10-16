import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import { useState, type ReactNode } from "react";

import { AlertCircleIcon, CircleCheckIcon, Copy01Icon } from "~/lib/icons";
import { useCopyToClipboard } from "~/lib/clipboard";
import { cn } from "~/lib/utils";
import { listRunningChatsFromDesktopStore } from "../../lib/runningChatsQuitConfirmation";
import { useStore } from "../../store";
import { GladeLogo } from "../GladeLogo";
import { ProviderIcon } from "../ProviderIcon";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import type { DesktopUpdateControls } from "./useDesktopUpdate";
import { groupByMachine, type ProviderUpdateItem } from "./usePendingProviderUpdates";
import type { UpdateRun } from "./useUpdateRun";

export interface UpdateSelection {
  readonly providers: ReadonlyArray<ProviderUpdateItem>;
  readonly restart: boolean;
}

const APP_ID = "app";

function UpdateRow(props: {
  readonly checkbox: ReactNode;
  readonly icon: ReactNode;
  readonly title: string;
  readonly detail: ReactNode;
  readonly trailing?: ReactNode;
}) {
  return (
    <li className="flex min-w-0 items-center gap-3 py-2">
      <span className="flex size-4 shrink-0 items-center justify-center">{props.checkbox}</span>
      <span className="flex size-5 shrink-0 items-center justify-center">{props.icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ui font-medium text-foreground">{props.title}</span>
        <span className="text-ui-sm text-muted-foreground">{props.detail}</span>
      </span>
      {props.trailing ? (
        <span className="flex shrink-0 items-center gap-1.5 text-ui-sm text-muted-foreground">
          {props.trailing}
        </span>
      ) : null}
    </li>
  );
}

function UpdateSection(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <h3 className="pt-2 text-ui-xs font-medium text-muted-foreground">{props.title}</h3>
      <ul className="m-0 flex list-none flex-col p-0">{props.children}</ul>
    </section>
  );
}

function versionRange(from: string | null | undefined, to: string | null | undefined) {
  return from && to ? `${from} → ${to}` : (to ?? from ?? "");
}

function CopyCommandButton({ command }: { readonly command: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  return (
    <Button size="xs" variant="outline" onClick={() => copyToClipboard(command)}>
      <Copy01Icon />
      {isCopied ? "Copied" : "Copy command"}
    </Button>
  );
}

function ProviderRowStatus(props: {
  readonly item: ProviderUpdateItem;
  readonly run: UpdateRun | null;
}) {
  const result = props.run?.results[props.item.id];
  if (result?.status === "running" || (!result && props.item.active)) {
    return (
      <>
        <Spinner variant="action" aria-hidden="true" className="size-3.5" />
        Updating
      </>
    );
  }
  if (result?.status === "done") {
    return (
      <>
        <CircleCheckIcon className="size-3.5 text-success" />
        Updated
      </>
    );
  }
  if (result?.status === "failed") {
    return (
      <>
        <AlertCircleIcon className="size-3.5 text-destructive" />
        Failed
      </>
    );
  }
  const command = props.item.provider.versionAdvisory?.updateCommand?.trim();
  return !props.item.oneClick && command ? <CopyCommandButton command={command} /> : null;
}

function providerDetail(item: ProviderUpdateItem, run: UpdateRun | null) {
  const result = run?.results[item.id];
  if (result?.status === "failed") {
    return <span className="text-destructive">{result.reason}</span>;
  }
  const advisory = item.provider.versionAdvisory;
  const versions = versionRange(advisory?.currentVersion, advisory?.latestVersion);
  return item.oneClick ? versions : `${versions} · updates outside Glade`;
}

function appDetail(desktop: DesktopUpdateControls, ready: boolean, runningChats: number) {
  if (desktop.installing) return "Restarting Glade.";
  if (!ready) return desktop.desktopUpdateTooltip;
  const versions = versionRange(desktop.desktopCurrentVersion, desktop.desktopUpdateReadyVersion);
  const chats =
    runningChats === 0
      ? ""
      : ` ${runningChats} running ${runningChats === 1 ? "chat pauses" : "chats pause"} and continue after.`;
  return `${versions}. Restarts Glade.${chats}`;
}

function AppRowTrailing({ desktop }: { readonly desktop: DesktopUpdateControls }) {
  if (desktop.installing)
    return <Spinner variant="action" aria-hidden="true" className="size-3.5" />;
  if (desktop.desktopUpdateDownloadPercent !== null) {
    return <span className="tabular-nums">{desktop.desktopUpdateDownloadPercent}%</span>;
  }
  if (desktop.desktopUpdateButtonAction === "download" && !desktop.desktopUpdateButtonDisabled) {
    return (
      <Button size="xs" variant="outline" onClick={desktop.handleDesktopUpdateButtonClick}>
        Retry
      </Button>
    );
  }
  return null;
}

export function UpdatesDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly desktopUpdate: DesktopUpdateControls;
  readonly appReady: boolean;
  readonly providerItems: ReadonlyArray<ProviderUpdateItem>;
  readonly run: UpdateRun | null;
  readonly onUpdate: (selection: UpdateSelection) => void;
}) {
  const { desktopUpdate: desktop, appReady, providerItems, run } = props;
  const [skippedIds, setSkippedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSkippedIds(new Set());
  }
  const runningChats = useStore((state) =>
    props.open ? listRunningChatsFromDesktopStore(state).length : 0,
  );

  const locked = run !== null;
  const selectableProviders = providerItems.filter((item) => item.oneClick && !item.active);
  const selectedProviders = locked
    ? []
    : selectableProviders.filter((item) => !skippedIds.has(item.id));
  const restartSelected = !locked && appReady && !skippedIds.has(APP_ID);
  const showApp = desktop.showDesktopUpdateButton || desktop.installing;
  const empty = !showApp && providerItems.length === 0;

  const toggle = (id: string, selected: boolean) =>
    setSkippedIds((current) => {
      const next = new Set(current);
      if (selected) next.delete(id);
      else next.add(id);
      return next;
    });
  const checkbox = (id: string, label: string, selectable: boolean) =>
    selectable && !locked ? (
      <Checkbox
        aria-label={label}
        checked={!skippedIds.has(id)}
        onCheckedChange={(checked) => toggle(id, checked === true)}
      />
    ) : null;

  const allDone =
    run?.finished === true && Object.values(run.results).every((r) => r.status === "done");

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Updates</DialogTitle>
          <DialogDescription>
            {empty
              ? "Glade and your providers are up to date."
              : run && !run.finished
                ? "Updating. You can close this window; updates keep running."
                : allDone
                  ? "Done. New chats use the updated providers."
                  : "Choose what to update."}
          </DialogDescription>
        </DialogHeader>
        {empty ? null : (
          <DialogPanel className="flex flex-col gap-1">
            {showApp ? (
              <UpdateSection title="App">
                <UpdateRow
                  checkbox={checkbox(APP_ID, "Update Glade", appReady)}
                  icon={<GladeLogo aria-hidden className="size-4 text-foreground" />}
                  title="Glade"
                  detail={appDetail(desktop, appReady, runningChats)}
                  trailing={<AppRowTrailing desktop={desktop} />}
                />
              </UpdateSection>
            ) : null}
            {groupByMachine(providerItems).map((machine) => (
              <UpdateSection
                key={machine.environmentKey}
                title={machine.machineLabel ?? "This computer"}
              >
                {machine.items.map((item) => {
                  const name = PROVIDER_DISPLAY_NAMES[item.provider.provider];
                  return (
                    <UpdateRow
                      key={item.id}
                      checkbox={checkbox(item.id, `Update ${name}`, item.oneClick && !item.active)}
                      icon={<ProviderIcon provider={item.provider.provider} className="size-4" />}
                      title={name}
                      detail={providerDetail(item, run)}
                      trailing={<ProviderRowStatus item={item} run={run} />}
                    />
                  );
                })}
              </UpdateSection>
            ))}
          </DialogPanel>
        )}
        <DialogFooter>
          {run?.finished ? (
            <>
              {run.restartHeld && appReady ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={desktop.handleDesktopUpdateButtonClick}
                >
                  Restart anyway
                </Button>
              ) : null}
              <DialogClose render={<Button size="sm" />}>Done</DialogClose>
            </>
          ) : (
            <>
              <DialogClose render={<Button variant="outline" size="sm" />}>
                {locked || empty ? "Close" : "Cancel"}
              </DialogClose>
              {empty ? null : (
                <Button
                  size="sm"
                  disabled={locked || (selectedProviders.length === 0 && !restartSelected)}
                  className={cn(locked && "cursor-progress")}
                  onClick={() =>
                    props.onUpdate({ providers: selectedProviders, restart: restartSelected })
                  }
                >
                  {locked ? (
                    <>
                      <Spinner variant="action" aria-hidden="true" className="size-3.5" />
                      Updating
                    </>
                  ) : restartSelected ? (
                    "Update and restart"
                  ) : (
                    "Update"
                  )}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
