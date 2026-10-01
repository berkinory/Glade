import {
  COMPUTER_HYPRLAND_BACKEND,
  COMPUTER_KWIN_BACKEND,
  COMPUTER_MAC_BACKEND,
  COMPUTER_NESTED_KWIN_BACKEND,
  COMPUTER_RELEASE_CONTROL_HOTKEY,
  COMPUTER_RELEASE_HOTKEY_BACKENDS,
  type ComputerCapabilities,
  type ComputerPermission,
} from "@glade/contracts/computer/computer";
import {
  COMPUTER_PERMISSIONS,
  computerPermissionSetupMessage,
  missingComputerPermissions,
} from "@glade/shared/computer/computerGrants";
import {
  computerPermissionSetupSupported,
  readLocalComputerPermissionBridge,
} from "~/lib/computerProvisioning";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import {
  DEFAULT_AGENT_CURSOR_COLOR_MODE,
  normalizeCursorHexColor,
  type AgentCursorColorMode,
  type AppSettingsBinding,
  type ComputerPreviewSize,
} from "~/appSettings";
import type { DesktopComputerSettingsPane, DesktopComputerState } from "@glade/contracts/ipc/ipc";
import {
  computerReconnectsNote,
  computerStatusNeedsSetup,
  resolveComputerAvailabilityView,
} from "~/components/ComputerPanel.logic";
import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { DisclosureRegion } from "~/components/ui/DisclosureRegion";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { useProvisionComputer } from "~/hooks/useProvisionComputer";
import { useRefreshOnWindowReturn } from "~/hooks/useRefreshOnWindowReturn";
import {
  ComputerPermissionSection,
  COMPUTER_PERMISSION_PANES,
  useComputerPermissionGuideBridge,
} from "./ComputerPermissionSection";
import {
  COMPUTER_STATUS_VISIBLE_REFETCH_INTERVAL_MS,
  computerStatusQueryOptions,
} from "~/lib/serverReactQuery";
import { cn } from "~/lib/utils";
import { settingRowAnchorId } from "~/settingsNavigation";
import { useAgentCursorDesktopSync } from "./agentCursorDesktopSync";
import { SettingResetButton, SettingsSegmentedControl } from "./SettingControls";
import { SettingsCard, SettingsRow, SettingsSectionShell } from "./SettingsPanelPrimitives";
import { ComputerGettingStarted } from "./ComputerGettingStarted";
import { ComputerAuditHistorySection } from "./ComputerAuditHistorySection";

const EMPTY_PERMISSIONS: readonly ComputerPermission[] = [];

const BACKEND_DISPLAY_NAMES: Record<string, string> = {
  [COMPUTER_KWIN_BACKEND]: "KWin plugin (KDE)",
  [COMPUTER_HYPRLAND_BACKEND]: "Hyprland plugin",
  [COMPUTER_NESTED_KWIN_BACKEND]: "Isolated agent desktop (nested KWin)",
  [COMPUTER_MAC_BACKEND]: "macOS desktop",
  cua: "Cua 0.28.2",
  fake: "Test backend",
};

const CAPABILITY_LABELS: ReadonlyArray<{
  readonly key: keyof ComputerCapabilities;
  readonly label: string;
}> = [
  { key: "capture", label: "screen capture" },
  { key: "input", label: "input" },
  { key: "windows", label: "window listing" },
  { key: "windowBounds", label: "window geometry" },
  { key: "stacking", label: "stacking order" },
  { key: "focus", label: "keyboard focus" },
  { key: "raise", label: "window raising" },
  { key: "clipboard", label: "clipboard" },
  { key: "ghostCursor", label: "ghost cursor" },
];

// The abilities to read out. `captureAvailable` is live health, not a static capability: a backend
// can advertise capture and still be unable to take a frame because the OS has not granted it, and
// listing "screen capture" in that state is the panel telling the user something the desktop cannot
// do.
function capabilitySummary(capabilities: ComputerCapabilities, captureAvailable: boolean): string {
  const enabled = CAPABILITY_LABELS.filter(
    (entry) => capabilities[entry.key] && (entry.key !== "capture" || captureAvailable),
  ).map((entry) => entry.label);
  return enabled.length > 0 ? enabled.join(", ") : "none";
}

function CursorColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);
  const resolved = normalizeCursorHexColor(value);
  const draftIsValid = draft.trim() === "" || normalizeCursorHexColor(draft) !== "";
  return (
    <label className="flex items-center gap-2">
      <span className="w-7 shrink-0 text-ui text-muted-foreground">{label}</span>
      <span
        aria-hidden
        data-swatch={resolved || "stock"}
        className={cn(
          "size-4 shrink-0 rounded-full border border-[color:var(--color-border)]",
          !resolved && "bg-transparent",
        )}
        style={resolved ? { backgroundColor: resolved } : undefined}
      />
      <Input
        size="sm"
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          if (next.trim() === "") {
            onChange("");
            return;
          }
          const normalized = normalizeCursorHexColor(next);
          if (normalized) onChange(normalized);
        }}
        onBlur={() => setDraft(value)}
        placeholder="#rrggbb"
        maxLength={7}
        spellCheck={false}
        autoComplete="off"
        aria-label={`${label} color`}
        aria-invalid={!draftIsValid}
        className="w-24"
      />
    </label>
  );
}

export function ComputerSettingsPanel({
  settings,
  defaults,
  updateSettings,
  active,
}: AppSettingsBinding & { readonly active: boolean }) {
  const statusQuery = useQuery({
    ...computerStatusQueryOptions(),
    enabled: active,

    refetchInterval: active ? COMPUTER_STATUS_VISIBLE_REFETCH_INTERVAL_MS : false,
  });

  const status = statusQuery.data;
  const [computerPermissionState, setComputerPermissionState] =
    useState<DesktopComputerState | null>(null);
  const [guidePane, setGuidePane] = useState<DesktopComputerSettingsPane | null>(null);

  const [advancedOpen, setAdvancedOpen] = useState(false);

  const localPermissionBridge = readLocalComputerPermissionBridge();
  const hasNativePermissionSetup =
    localPermissionBridge !== null && computerPermissionSetupSupported(computerPermissionState);
  const nativePermissionSetupError =
    hasNativePermissionSetup && computerPermissionState?.permissionSetupErrorCode
      ? computerPermissionState.message
      : null;

  const refreshPermissionState = useCallback(() => {
    const bridge = readLocalComputerPermissionBridge();
    if (!bridge) return;
    void bridge
      .getState(COMPUTER_PERMISSIONS)
      .then((next) => setComputerPermissionState(next))
      .catch(() => undefined);
  }, []);
  useRefreshOnWindowReturn(() => {
    void statusQuery.refetch({ cancelRefetch: false });
    refreshPermissionState();
  }, active);

  useAgentCursorDesktopSync(settings);

  useComputerPermissionGuideBridge({
    permissionKinds: COMPUTER_PERMISSIONS,
    onStateChange: setComputerPermissionState,
    onGuidePaneChange: setGuidePane,
  });

  useEffect(() => {
    const bridge = readLocalComputerPermissionBridge();
    if (!bridge || !active) return;
    let disposed = false;
    const unsubscribe = bridge.onState((state) => {
      if (!disposed) setComputerPermissionState(state);
    });
    void bridge
      .getState(COMPUTER_PERMISSIONS)
      .then((next) => {
        if (!disposed) setComputerPermissionState(next);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [active]);

  const nativeMissingPermissions =
    hasNativePermissionSetup && computerPermissionState
      ? missingComputerPermissions(computerPermissionState)
      : EMPTY_PERMISSIONS;
  const missingPermissions =
    nativeMissingPermissions.length > 0
      ? nativeMissingPermissions
      : status?.availability.kind === "permission-required"
        ? status.availability.missing
        : EMPTY_PERMISSIONS;

  const grantsConfirmed =
    hasNativePermissionSetup &&
    computerPermissionState !== null &&
    nativePermissionSetupError === null &&
    nativeMissingPermissions.length === 0;

  const availability =
    nativeMissingPermissions.length > 0 && status?.availability.kind === "available"
      ? {
          kind: "permission-required" as const,
          missing: nativeMissingPermissions,
          buildSignature: "unknown" as const,
          message: computerPermissionSetupMessage(nativeMissingPermissions, "unknown"),
        }
      : status?.availability;
  // The same provision the chat's setup card runs, through the same hook: one call in flight at a
  // time whichever surface started it, and one account of what happened. This surface keeps that
  // account inline rather than as a toast, because it has room for it and is where the user is
  // already looking.
  const setup = useProvisionComputer({ missing: missingPermissions });

  if (!active) return null;

  const availabilityView = statusQuery.isError
    ? {
        kind: "blocked" as const,
        title: "Computer status is unavailable",
        description:
          statusQuery.error instanceof Error && statusQuery.error.message
            ? statusQuery.error.message
            : "The server could not be reached.",
      }
    : resolveComputerAvailabilityView(availability, status?.health, grantsConfirmed);
  const backend =
    status?.availability.kind === "available" ? (status.availability.backend ?? null) : null;
  const health = status?.health;
  // Elsewhere, the emergency release is a shortcut the compositor plugin (KWin or Hyprland) registers
  // with the compositor — no other backend binds it, and a nested offscreen session never hears the
  // human's keys, so only a visible plugin-backed desktop may promise it.
  const capabilitiesDescription =
    backend === "cua" && status?.capabilities.input === false
      ? "This backend can observe desktop windows, but native desktop input is unavailable. Isolated headless browser actions require a verified browser runtime and an available task-scoped Escape shortcut. Use Stop in the chat to interrupt the task."
      : backend === COMPUTER_MAC_BACKEND || backend === "cua"
        ? "The agent shares your Mac desktop and works in the background by default. It can bring a window forward when your task asks to watch. Background input may still affect focus. Use Stop in the chat to interrupt the task. Physical Escape interrupts the current action when Input Monitoring is granted; it does not disable future tasks."
        : backend !== null &&
            COMPUTER_RELEASE_HOTKEY_BACKENDS.includes(backend) &&
            status?.capabilities.visibleDesktop === true
          ? `The agent shares the computer described by this backend. Press ${COMPUTER_RELEASE_CONTROL_HOTKEY} at any time to stop it from acting on the desktop, and press it again to let it resume.`
          : "The agent drives its own seat, so your cursor and focus stay untouched.";
  // Unproven capture can offer setup; only a running helper that cannot capture proves an OS refusal.
  const captureUnavailable = health?.captureAvailable === false;
  const captureBlocked = captureUnavailable && health?.status === "connected";
  const localPlatformUnsupported =
    localPermissionBridge !== null &&
    computerPermissionState !== null &&
    computerPermissionState.platform !== "macos";

  const needsSetup =
    !localPlatformUnsupported &&
    (nativePermissionSetupError !== null ||
      nativeMissingPermissions.length > 0 ||
      computerStatusNeedsSetup(status, grantsConfirmed));

  const healthNotes = [computerReconnectsNote(health)].filter(
    (note): note is string => note !== null,
  );

  const showAttentionRow =
    nativePermissionSetupError !== null ||
    availabilityView.kind === "ready" ||
    availabilityView.kind === "blocked" ||
    (availabilityView.kind === "checking" && (needsSetup || health?.status === "reconnecting"));
  const attentionTitle = nativePermissionSetupError
    ? "Computer permission setup needs attention"
    : captureBlocked
      ? "Screen capture is not allowed yet"
      : availabilityView.title;
  const attentionDescription =
    nativePermissionSetupError ??
    (captureBlocked
      ? backend === COMPUTER_MAC_BACKEND
        ? "The agent can act on the desktop but cannot see it, so screenshots fail. Turn Glade on in System Settings › Privacy & Security › Screen Recording, then press Set up to reconnect."
        : "The agent can act on the desktop but cannot see it, so screenshots fail. Press Set up to reconnect."
      : availabilityView.description);
  const attentionTone = cn(
    "size-2 shrink-0 rounded-full",
    nativePermissionSetupError
      ? "bg-red-500"
      : availabilityView.kind === "ready"
        ? "bg-emerald-500"
        : availabilityView.kind === "checking"
          ? "animate-pulse bg-amber-500"
          : captureBlocked
            ? "bg-amber-500"
            : "bg-red-500",
  );
  const attentionAction =
    needsSetup && !statusQuery.isError ? (
      <Button size="sm" variant="outline" disabled={setup.isPending} onClick={setup.provision}>
        {setup.isPending ? "Setting up…" : "Set up"}
      </Button>
    ) : statusQuery.isError ? (
      <Button
        size="sm"
        variant="outline"
        disabled={statusQuery.isFetching}
        onClick={() => {
          void statusQuery.refetch();
          refreshPermissionState();
        }}
      >
        {statusQuery.isFetching ? "Checking…" : "Check again"}
      </Button>
    ) : null;

  const cursorColorMode = settings.agentCursorColorMode ?? DEFAULT_AGENT_CURSOR_COLOR_MODE;
  const cursorColorsDirty =
    cursorColorMode !== (defaults.agentCursorColorMode ?? DEFAULT_AGENT_CURSOR_COLOR_MODE) ||
    (settings.agentCursorFillColor ?? "") !== (defaults.agentCursorFillColor ?? "") ||
    (settings.agentCursorRimColor ?? "") !== (defaults.agentCursorRimColor ?? "");
  const previewDirty =
    settings.autoOpenComputerPane !== defaults.autoOpenComputerPane ||
    settings.computerPreviewSize !== defaults.computerPreviewSize;

  return (
    <div className="space-y-6">
      {}
      <SettingsSectionShell
        id={settingRowAnchorId("Computer control")}
        title="Computer control"
        action={
          <div className="flex items-center gap-1.5">
            {settings.computerControlEnabled !== defaults.computerControlEnabled ? (
              <SettingResetButton
                label="computer control"
                onClick={() =>
                  updateSettings({ computerControlEnabled: defaults.computerControlEnabled })
                }
              />
            ) : null}
            <Switch
              checked={settings.computerControlEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ computerControlEnabled: Boolean(checked) })
              }
              aria-label="Let the agent use the desktop in any chat"
            />
          </div>
        }
      >
        <p className="px-2 text-ui text-muted-foreground">
          Enable Computer by default in any chat. Leave this off and use /computer-use for one
          request without adding Computer tools to ordinary turns.
        </p>
        <SettingsCard>
          {showAttentionRow ? (
            <SettingsRow
              title={
                <span className="flex items-center gap-2">
                  <span aria-hidden className={attentionTone} />
                  {attentionTitle}
                </span>
              }
              description={attentionDescription}
              status={[setup.note, ...healthNotes].filter(Boolean).join(" ") || undefined}
              control={attentionAction}
            />
          ) : null}
          {}
          <SettingsRow
            title="Cursor colors"
            description="The agent pointer is stock monochrome by default — like a normal pointer. Custom colors apply to new computer sessions."
            resetAction={
              cursorColorsDirty ? (
                <SettingResetButton
                  label="cursor colors"
                  onClick={() =>
                    updateSettings({
                      agentCursorColorMode:
                        defaults.agentCursorColorMode ?? DEFAULT_AGENT_CURSOR_COLOR_MODE,
                      agentCursorFillColor: defaults.agentCursorFillColor ?? "",
                      agentCursorRimColor: defaults.agentCursorRimColor ?? "",
                    })
                  }
                />
              ) : null
            }
            control={
              <SettingsSegmentedControl<AgentCursorColorMode>
                value={cursorColorMode}
                onValueChange={(value) => updateSettings({ agentCursorColorMode: value })}
                options={[
                  { value: "stock", label: "Stock" },
                  { value: "custom", label: "Custom" },
                ]}
                ariaLabel="Agent cursor colors"
              />
            }
          >
            {cursorColorMode === "custom" ? (
              <div className="flex flex-col gap-2 pt-3 sm:flex-row sm:gap-4">
                <CursorColorField
                  label="Fill"
                  value={settings.agentCursorFillColor ?? ""}
                  onChange={(value) => updateSettings({ agentCursorFillColor: value })}
                />
                <CursorColorField
                  label="Rim"
                  value={settings.agentCursorRimColor ?? ""}
                  onChange={(value) => updateSettings({ agentCursorRimColor: value })}
                />
              </div>
            ) : null}
          </SettingsRow>
          {}
          <SettingsRow
            title="Preview"
            description="Show the live preview the first time an agent acts on the desktop in a chat. Compact keeps it small and glanceable; Large gives it the full wide card."
            resetAction={
              previewDirty ? (
                <SettingResetButton
                  label="preview"
                  onClick={() =>
                    updateSettings({
                      autoOpenComputerPane: defaults.autoOpenComputerPane,
                      computerPreviewSize: defaults.computerPreviewSize,
                    })
                  }
                />
              ) : null
            }
            control={
              <div className="flex w-full items-center gap-3 sm:w-auto sm:justify-end">
                <Switch
                  checked={settings.autoOpenComputerPane}
                  onCheckedChange={(checked) =>
                    updateSettings({ autoOpenComputerPane: Boolean(checked) })
                  }
                  aria-label="Show the computer preview automatically when an agent drives the desktop"
                />
                <SettingsSegmentedControl<ComputerPreviewSize>
                  value={settings.computerPreviewSize}
                  onValueChange={(value) => updateSettings({ computerPreviewSize: value })}
                  options={[
                    { value: "compact", label: "Compact" },
                    { value: "large", label: "Large" },
                  ]}
                  ariaLabel="In-chat computer preview size"
                />
              </div>
            }
          />
        </SettingsCard>
      </SettingsSectionShell>

      <ComputerGettingStarted />
      <ComputerAuditHistorySection />

      {}
      <SettingsSectionShell
        title="Advanced"
        action={
          <Button
            size="xs"
            variant="ghost"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            <DisclosureChevron open={advancedOpen} />
            {advancedOpen ? "Hide" : "Show"}
          </Button>
        }
      >
        <DisclosureRegion open={advancedOpen}>
          <div className="flex flex-col gap-4">
            {hasNativePermissionSetup && computerPermissionState ? (
              <ComputerPermissionSection
                panes={COMPUTER_PERMISSION_PANES}
                permissionKinds={COMPUTER_PERMISSIONS}
                feature="Computer control"
                state={computerPermissionState}
                onStateChange={setComputerPermissionState}
                guidePane={guidePane}
                onGuidePaneChange={setGuidePane}
                showRecheck={false}
              />
            ) : null}
            <SettingsCard>
              {status && availabilityView.kind === "ready" ? (
                <SettingsRow
                  title="Desktop abilities"
                  description={capabilitiesDescription}
                  status={`${backend ? (BACKEND_DISPLAY_NAMES[backend] ?? backend) : "No backend"} · ${capabilitySummary(status.capabilities, !captureBlocked)}`}
                />
              ) : null}
            </SettingsCard>
          </div>
        </DisclosureRegion>
      </SettingsSectionShell>
    </div>
  );
}
