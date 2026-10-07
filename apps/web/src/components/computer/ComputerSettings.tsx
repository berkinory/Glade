import type { ComputerAccessScope } from "@glade/contracts/computer/computerUse";
import type { DesktopComputerPermissions } from "@glade/contracts/ipc/ipc";
import type {
  ComputerDriverStatus,
  ComputerGrantView,
} from "@glade/contracts/transport/ws/computerRpc";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useEffect, useState } from "react";
import { isElectron } from "~/env";
import {
  getNavigatorPlatform,
  isLinuxPlatform,
  isMacPlatform,
  isWindowsPlatform,
} from "~/lib/utils";
import { RUNTIME_MODE_PRESENTATION } from "~/lib/runtimeMode";
import { readNativeApi } from "~/nativeApi";
import { useStore } from "~/store";
import {
  SettingsEmptyState,
  SettingsListRow,
  SettingsRow,
  SettingsSection,
  SettingsSectionShell,
  SettingsCard,
} from "../settings/SettingsPanelPrimitives";
import { BrowserContentBlockerRow } from "../browser/BrowserContentBlockerRow";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { ComputerKillSwitchKbd } from "./ComputerKillSwitchKbd";
import { useComputerState } from "./computerUseState";

const SCOPE_LABEL: Record<ComputerAccessScope, string> = {
  read: "Read",
  act: "Act",
  full: "Full control",
};

function platformLimits(platform: string): string {
  if (isWindowsPlatform(platform)) {
    return "On Windows, actions that need the real pointer or keyboard bring the window to the front while they run.";
  }
  if (isLinuxPlatform(platform)) {
    return "On Linux, X11 apps accept background input. On Wayland only accessibility-tree actions work; screenshot-driven actions need the window in front.";
  }
  return "Computer Use is not supported on this platform.";
}

function DriverRow(props: { status: ComputerDriverStatus | null }) {
  const { status } = props;
  const description =
    status === null
      ? "Checking…"
      : status.state === "ready"
        ? `Running, version ${status.driverVersion}.`
        : status.message;
  const problems = status?.state === "ready" ? status.healthProblems : [];
  return (
    <SettingsRow
      id="setting-computer-driver"
      title="Cua Driver"
      description={description}
      status={problems.length > 0 ? `Health checks: ${problems.join(", ")}` : undefined}
    />
  );
}

// macOS grants attach to Glade itself. They are re-read whenever the window regains focus, which
// is when the user comes back from System Settings.
function PermissionRows() {
  const bridge = window.desktopBridge?.computer;
  const [permissions, setPermissions] = useState<DesktopComputerPermissions | null>(null);
  useEffect(() => {
    if (!bridge) return;
    let disposed = false;
    const refresh = () => {
      void bridge.getPermissions().then(
        (next) => {
          if (!disposed) setPermissions(next);
        },
        () => undefined,
      );
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      disposed = true;
      window.removeEventListener("focus", refresh);
    };
  }, [bridge]);
  if (!bridge) return null;

  const run = (action: () => Promise<unknown>) => {
    void action()
      .then(() => bridge.getPermissions())
      .then(setPermissions)
      .catch((error: unknown) =>
        toastManager.add({
          type: "error",
          title: "Could not open macOS permissions",
          description: error instanceof Error ? error.message : String(error),
        }),
      );
  };
  const rows = [
    {
      key: "accessibility",
      title: "Accessibility",
      description: "Lets the agent read app interfaces and send input.",
      granted: permissions?.accessibility ?? null,
      action: { label: "Request", run: () => run(bridge.requestPermissions) },
    },
    {
      key: "screen-recording",
      title: "Screen Recording",
      description: "Lets the agent take window screenshots. Add Glade in System Settings.",
      granted: permissions?.screenRecording ?? null,
      action: { label: "Open System Settings", run: () => run(bridge.openSettings) },
    },
  ] as const;
  return rows.map((row) => (
    <SettingsRow
      key={row.key}
      title={row.title}
      description={row.description}
      status={row.granted === null ? "Checking…" : row.granted ? "Granted" : "Not granted"}
      control={
        row.granted === false ? (
          <Button size="sm" variant="outline" onClick={row.action.run}>
            {row.action.label}
          </Button>
        ) : undefined
      }
    />
  ));
}

function GrantRow(props: { threadId: ThreadId; grant: ComputerGrantView }) {
  const { threadId, grant } = props;
  const threadTitle = useStore((state) => state.sidebarThreadSummaryById[threadId]?.title);
  const target = grant.windowTitle
    ? `${grant.app} · "${grant.windowTitle}"`
    : grant.windowId === null
      ? `${grant.app} · all windows`
      : `${grant.app} · window ${grant.windowId}`;
  const revoke = () => {
    readNativeApi()
      ?.computer.revokeGrant({ threadId, app: grant.app, windowId: grant.windowId })
      .catch((error: unknown) =>
        toastManager.add({
          type: "error",
          title: "Could not revoke access",
          description: error instanceof Error ? error.message : String(error),
        }),
      );
  };
  return (
    <SettingsListRow
      title={threadTitle ?? "Untitled chat"}
      description={`${target} · ${SCOPE_LABEL[grant.scope]}${
        grant.autoGrantedIn
          ? ` · auto (${RUNTIME_MODE_PRESENTATION[grant.autoGrantedIn].label})`
          : ""
      }`}
      actions={
        <Button size="sm" variant="outline" onClick={revoke}>
          Revoke
        </Button>
      }
    />
  );
}

export function ComputerSettings() {
  const state = useComputerState();
  if (!isElectron) {
    return <SettingsEmptyState>Computer Use needs the Glade desktop app.</SettingsEmptyState>;
  }
  const platform = getNavigatorPlatform();
  const isMac = isMacPlatform(platform);
  const grants = (state?.threads ?? []).flatMap((thread) =>
    thread.grants.map((grant) => ({ threadId: thread.threadId, grant })),
  );
  return (
    <div className="space-y-6">
      <SettingsSection title="Browser">
        <BrowserContentBlockerRow />
      </SettingsSection>
      <SettingsSection title="Computer Use">
        <DriverRow status={state?.status ?? null} />
        <SettingsRow
          id="setting-computer-kill-switch"
          title="Stop shortcut"
          description="Stops Computer Use in every chat from any app, even while the agent is using the pointer."
          control={<ComputerKillSwitchKbd />}
        />
        {isMac ? null : (
          <SettingsRow
            id="setting-computer-platform"
            title="Platform"
            description={platformLimits(platform)}
          />
        )}
      </SettingsSection>
      {isMac ? (
        <SettingsSection title="macOS permissions">
          <PermissionRows />
        </SettingsSection>
      ) : null}
      <SettingsSectionShell title="Access grants" id="setting-computer-grants">
        {grants.length === 0 ? (
          <SettingsEmptyState>
            No app access granted. Turn Computer Use on with /computer or the chat menu; the agent
            asks before it uses an app. Grants last until Glade restarts.
          </SettingsEmptyState>
        ) : (
          <SettingsCard>
            {grants.map(({ threadId, grant }) => (
              <GrantRow
                key={`${threadId}:${grant.app}:${grant.windowId ?? "*"}`}
                threadId={threadId}
                grant={grant}
              />
            ))}
          </SettingsCard>
        )}
      </SettingsSectionShell>
    </div>
  );
}
