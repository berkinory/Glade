// FILE: ComputerPermissionSection.tsx
// Purpose: The single guided macOS permission checklist — per-pane Grant buttons that deep-link
//          System Settings, run the floating GrantCoach, and poll until the grant lands. Shared
//          for Accessibility, Screen Recording and Input Monitoring.
// Layer: Settings UI component

import {
  type DesktopComputerPermission,
  type DesktopComputerPermissionKind,
  type DesktopComputerSettingsPane,
  type DesktopComputerState,
} from "@glade/contracts";
import { useEffect, useRef, useState } from "react";

function createLatestPermissionRequestGuard() {
  let latestRequestId = 0;
  return {
    begin: () => ++latestRequestId,
    isCurrent: (requestId: number) => requestId === latestRequestId,
  };
}
import { DisclosureRegion } from "~/components/ui/DisclosureRegion";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { toastManager } from "~/components/ui/toast";
import { cn } from "~/lib/utils";
import { ComputerPermissionGuide } from "./ComputerPermissionGuide";
import { SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";

export interface ComputerPermissionPaneDescriptor {
  readonly pane: DesktopComputerSettingsPane;
  readonly title: string;
  readonly description: string;
}

/**
 * Computer also needs Input Monitoring for Escape and human takeover. This
 * grant does not authorize a task. The matching kind list lives in
 * `@glade/shared/computerGrants`.
 */
export const COMPUTER_PERMISSION_PANES: readonly ComputerPermissionPaneDescriptor[] = [
  {
    pane: "accessibility",
    title: "Accessibility",
    description:
      "Lets Glade move the pointer, click, and type on your behalf. Nothing is driven unless you authorize a Computer task.",
  },
  {
    pane: "screen-recording",
    title: "Screen Recording",
    description:
      "Lets Glade capture windows and the desktop so the agent can see what it is driving.",
  },
  {
    pane: "input-monitoring",
    title: "Input Monitoring",
    description: "Lets Glade detect Escape and pause when you take over during a Computer task.",
  },
];

const PERMISSION_LABELS: Record<DesktopComputerPermission, string> = {
  granted: "Granted",
  denied: "Denied",
  "not-determined": "Not requested yet",
  restricted: "Restricted",
  unknown: "Unknown",
};

const PANE_LABELS: Record<DesktopComputerSettingsPane, string> = {
  accessibility: "Accessibility",
  "input-monitoring": "Input Monitoring",
  "screen-recording": "Screen Recording",
};

function ComputerPermissionBadge({ permission }: { permission: DesktopComputerPermission }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-ui-xs font-medium text-muted-foreground">
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          permission === "granted"
            ? "bg-emerald-500"
            : permission === "denied" || permission === "restricted"
              ? "bg-red-500"
              : "bg-[color:var(--color-border)]",
        )}
      />
      {PERMISSION_LABELS[permission]}
    </span>
  );
}

export function computerPanePermission(
  state: DesktopComputerState,
  pane: DesktopComputerSettingsPane,
): DesktopComputerPermission {
  if (pane === "input-monitoring") return state.inputMonitoringPermission;
  if (pane === "accessibility") return state.accessibilityPermission ?? "unknown";
  return state.screenRecordingPermission;
}

/**
 * Keeps the parent-owned guide state honest while the settings surface lives:
 * a native "granted" refreshes the permission snapshot; a dismissed coach
 * ("closed") clears the remembered pane so it cannot resurrect on the next
 * mount. Panels call this at panel level — hooks above an `if (!active)
 * return null` stay mounted while the surface is hidden, which is exactly
 * when the coach can still report a dismissal.
 */
export function useComputerPermissionGuideBridge({
  permissionKinds,
  onStateChange,
  onGuidePaneChange,
}: {
  readonly permissionKinds?: readonly DesktopComputerPermissionKind[];
  readonly onStateChange: (state: DesktopComputerState) => void;
  readonly onGuidePaneChange: (pane: DesktopComputerSettingsPane | null) => void;
}): void {
  const onStateChangeRef = useRef(onStateChange);
  const onGuidePaneChangeRef = useRef(onGuidePaneChange);
  const permissionKindsRef = useRef(permissionKinds);
  onStateChangeRef.current = onStateChange;
  onGuidePaneChangeRef.current = onGuidePaneChange;
  permissionKindsRef.current = permissionKinds;

  useEffect(() => {
    const bridge = window.desktopBridge?.computerPermissions;
    if (!bridge) return;
    let disposed = false;
    const unsubscribe = bridge.onPermissionGuideState((guideState) => {
      if (disposed) return;
      if (guideState === "granted") {
        // Refresh the real permission state so the success effect can close the
        // guide and show the "Permission granted" toast.
        void bridge
          .getState(permissionKindsRef.current)
          .then((next) => {
            if (!disposed) onStateChangeRef.current(next);
          })
          .catch(() => undefined);
      } else if (guideState === "closed") {
        // The coach was dismissed (e.g., Escape). Close the matching inline
        // guide. The manager only forwards events from the active guide, so a
        // stale 'closed' from a replaced guide cannot close a newer pane.
        onGuidePaneChangeRef.current(null);
      }
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);
}

/**
 * Renders one row per pane plus a Recheck footer. The parent owns the permission state
 * state (it may drive other UI off it); this section owns the open guide, the
 * floating coach sync, and the recheck button. `permissionKinds` scopes every
 * helper call — undefined means the helper's legacy pair. The parent must also
 * mount `useComputerPermissionGuideBridge` at panel level: this section unmounts
 * with the surface, but the native coach can still report while it is hidden.
 */
export function ComputerPermissionSection({
  panes,
  permissionKinds,
  feature,
  state,
  onStateChange,
  guidePane,
  onGuidePaneChange,
  showRecheck = true,
}: {
  readonly panes: readonly ComputerPermissionPaneDescriptor[];
  readonly permissionKinds?: readonly DesktopComputerPermissionKind[];
  /** Feature name used in the granted toast, e.g. "Computer control". */
  readonly feature: string;
  readonly state: DesktopComputerState;
  readonly onStateChange: (state: DesktopComputerState) => void;
  readonly guidePane: DesktopComputerSettingsPane | null;
  readonly onGuidePaneChange: (pane: DesktopComputerSettingsPane | null) => void;
  /**
   * Whether to render the Recheck footer row. A surface that already owns a
   * status action (the Computer panel's Set up) passes false so the same check
   * does not appear twice.
   */
  readonly showRecheck?: boolean;
}) {
  const [recheckPending, setRecheckPending] = useState(false);
  const requestGuardRef = useRef(createLatestPermissionRequestGuard());
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;

  // macOS fires no event when a TCC permission changes, so an open guide polls
  // the helper's preflight until the grant shows up (or the user restarts).
  useEffect(() => {
    if (!guidePane) return;
    const bridge = window.desktopBridge?.computerPermissions;
    if (!bridge) return;
    let disposed = false;
    const poll = () => {
      void bridge
        .getState(permissionKinds)
        .then((next) => {
          if (!disposed) onStateChangeRef.current(next);
        })
        .catch(() => undefined);
    };
    poll();
    const interval = setInterval(poll, 2_000);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [guidePane, permissionKinds]);

  // The floating drag-in coach lives for exactly as long as the inline guide.
  // Only hide what this surface showed: mounting with no guide must not close a
  // coach a startPermissionSetup session is still driving. Unmounting with a
  // shown guide hides it, so navigating away cannot strand the coach on screen;
  // pressing Grant again re-shows it.
  const shownGuidePaneRef = useRef<DesktopComputerSettingsPane | null>(null);
  useEffect(() => {
    const bridge = window.desktopBridge?.computerPermissions;
    if (!bridge) return;
    if (guidePane) {
      shownGuidePaneRef.current = guidePane;
      void bridge.showPermissionGuide(guidePane).catch(() => undefined);
    } else if (shownGuidePaneRef.current) {
      shownGuidePaneRef.current = null;
      void bridge.hidePermissionGuide?.();
    }
    return () => {
      if (shownGuidePaneRef.current) {
        shownGuidePaneRef.current = null;
        void window.desktopBridge?.computerPermissions?.hidePermissionGuide?.();
      }
    };
  }, [guidePane]);

  useEffect(() => {
    if (!guidePane) return;
    if (computerPanePermission(state, guidePane) !== "granted") return;
    const paneLabel = PANE_LABELS[guidePane];
    onGuidePaneChange(null);
    toastManager.add({
      type: "success",
      title: "Permission granted",
      description: `${paneLabel} is ready for ${feature}.`,
    });
  }, [guidePane, state, feature, onGuidePaneChange]);

  async function recheckPermissions() {
    const bridge = window.desktopBridge?.computerPermissions;
    if (!bridge || recheckPending) return;
    const requestGuard = requestGuardRef.current;
    const requestId = requestGuard.begin();
    setRecheckPending(true);
    try {
      // getState runs the helper's preflight only: a recheck must re-read TCC,
      // not raise the macOS permission prompts again.
      const next = await bridge.getState(permissionKinds);
      if (!requestGuard.isCurrent(requestId)) return;
      onStateChangeRef.current(next);
      if (next.status === "permission-required") {
        toastManager.add({
          type: "info",
          title: "Permissions unchanged",
          description: "Use Grant next to a permission to walk through setup.",
        });
      }
    } catch (error) {
      if (!requestGuard.isCurrent(requestId)) return;
      toastManager.add({
        type: "error",
        title: "Could not check permissions",
        description: error instanceof Error ? error.message : "Permission check failed.",
      });
    } finally {
      if (requestGuard.isCurrent(requestId)) setRecheckPending(false);
    }
  }

  return (
    <SettingsSection title="macOS permissions">
      {panes.map(({ pane, title, description }) => {
        const permission = computerPanePermission(state, pane);
        const guideOpen = guidePane === pane;
        return (
          <SettingsRow
            key={pane}
            title={title}
            description={description}
            control={
              <div className="flex items-center gap-2">
                <ComputerPermissionBadge permission={permission} />
                {permission !== "granted" ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      const nextPane = guideOpen ? null : pane;
                      onGuidePaneChange(nextPane);
                      if (nextPane) {
                        void window.desktopBridge?.computerPermissions
                          ?.openPermissionSettings(pane)
                          .catch(() => undefined);
                      }
                    }}
                  >
                    {guideOpen ? "Hide steps" : "Grant"}
                  </Button>
                ) : null}
              </div>
            }
          >
            <DisclosureRegion open={guideOpen}>
              <div className="pt-3">
                <ComputerPermissionGuide
                  pane={pane}
                  appDisplayName={state.appDisplayName}
                  waiting={permission !== "granted"}
                  onOpenSettings={() => {
                    void window.desktopBridge?.computerPermissions
                      ?.openPermissionSettings(pane)
                      .catch(() => undefined);
                  }}
                  onRestart={() => {
                    void window.desktopBridge?.computerPermissions?.restartApp();
                  }}
                />
              </div>
            </DisclosureRegion>
          </SettingsRow>
        );
      })}
      {showRecheck ? (
        <SettingsRow
          title="Permission status"
          description="Grant each permission with the steps above. If you take longer than 10 minutes, press Set up again."
          control={
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={recheckPending}
              onClick={() => void recheckPermissions()}
            >
              {recheckPending ? (
                <>
                  <Spinner className="size-3" />
                  Rechecking…
                </>
              ) : (
                "Recheck permissions"
              )}
            </Button>
          }
        />
      ) : null}
    </SettingsSection>
  );
}
