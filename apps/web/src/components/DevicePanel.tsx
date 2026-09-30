import type {
  DeviceDescriptor,
  DeviceHardwareButton,
  DeviceUdid,
} from "@glade/contracts/device/device";
import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ensureNativeApi } from "~/nativeApi";
import { addWsTransportStateListener } from "~/wsTransportEvents";
import type { DockPaneRuntimeMode } from "~/lib/dockPaneActivation";
import { CheckIcon, ChevronDownIcon, LoaderCircleIcon, XIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

import { selectThreadDeviceState, useDeviceStateStore } from "../deviceStateStore";
import {
  buildDevicePickerEntries,
  canvasPointToDevicePoint,
  createDeviceRecordingState,
  deviceAttachStatusLabel,
  deviceHidUsageForKey,
  deviceKeyModifiers,
  deviceRecordingClickIntent,
  deviceSetupCheckingLabel,
  isDeviceRecordingActive,
  resolveDeviceAvailabilityView,
  resolveDisplayedDevice,
  type PendingDeviceSelection,
  resolveDeviceHardwareButtonShortcut,
  resolveDevicePointerGesture,
  resolveDevicePointSize,
  resolveDeviceSetupAction,
  shouldSubscribeToDeviceStream,
  stepDeviceRecording,
  type DevicePoint,
} from "./DevicePanel.logic";
import { DeviceScreen, deviceKindFor, RESOLUTION_SCALE } from "./device/DeviceFrame";
import {
  DEVICE_RAIL_HEIGHT_CLASS,
  DeviceControlRail,
  type DeviceRailAction,
} from "./device/DeviceControlRail";
import {
  DeviceBootingScreen,
  DeviceEmptyScreen,
  DeviceSetupScreen,
} from "./device/DeviceScreenStates";
import { useDeviceVideoStream } from "./device/useDeviceVideoStream";
import { DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import { ComposerPickerMenuPopup } from "./chat/ComposerPickerMenuPopup";
import { Button } from "./ui/button";
import { Menu, MenuItem, MenuTrigger } from "./ui/menu";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";

import { toastManager } from "./ui/toast";

const DEVICE_SETUP_POLL_INTERVAL_MS = 5_000;

function describeDeviceError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

export default function DevicePanel(props: {
  mode: DiffPanelMode;
  threadId: ThreadId;
  runtimeMode: DockPaneRuntimeMode;
  isVisible: boolean;
  onClosePanel: () => void;
  onRequestLive?: () => void;
}) {
  const { threadId, runtimeMode, isVisible } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const threadState = useDeviceStateStore(selectThreadDeviceState(threadId));
  const upsertThreadState = useDeviceStateStore((store) => store.upsertThreadState);
  const [busy, setBusy] = useState(false);
  const [shutdownConfirm, setShutdownConfirm] = useState(false);
  const [landscape, setLandscape] = useState(false);
  const [bootLimit, setBootLimit] = useState<{
    readonly limit: number;
    readonly candidates: readonly DeviceDescriptor[];

    readonly pendingUdid: DeviceUdid;

    readonly pendingName: string;
  } | null>(null);

  const [pendingDevice, setPendingDevice] = useState<PendingDeviceSelection | null>(null);
  const attachedDevice = resolveDisplayedDevice({ threadState, pending: pendingDevice });
  const availabilityView = resolveDeviceAvailabilityView(
    threadState?.availability ?? { kind: "available" },
  );

  const reportedUdid = threadState?.attachedDeviceUdid ?? null;
  useEffect(() => {
    setPendingDevice((current) =>
      current && reportedUdid !== current.supersedes ? null : current,
    );
  }, [reportedUdid]);

  const pollSetupState =
    availabilityView.kind === "blocked" && availabilityView.retryable ? "blocked" : null;

  // The pane is the only reader of this thread's device state, so it seeds the store on mount; every
  // later change arrives on the device.event push. Re-seeded whenever the socket comes back, because
  // that push carries no snapshot: a boot, attach or shutdown that completed while the browser was
  // disconnected is simply missed, and the pane would sit on the pre-outage phase and device list
  // until some unrelated device event arrived.
  useEffect(() => {
    let cancelled = false;
    const seed = () => {
      void ensureNativeApi()
        .device.getThreadState({ threadId })
        .then((state) => {
          if (!cancelled) upsertThreadState(state);
        })
        .catch(() => {});
    };
    seed();
    const unsubscribe = addWsTransportStateListener((state) => {
      if (state === "open") seed();
    });

    const poll = pollSetupState !== null ? setInterval(seed, DEVICE_SETUP_POLL_INTERVAL_MS) : null;
    return () => {
      cancelled = true;
      unsubscribe();
      if (poll !== null) clearInterval(poll);
    };
  }, [threadId, upsertThreadState, pollSetupState]);

  const attachStatusLabel = attachedDevice
    ? deviceAttachStatusLabel({
        phase: threadState?.attachPhase,
        deviceState: attachedDevice.state,
        pendingSelection: pendingDevice !== null,
      })
    : null;

  const streamEnabled = shouldSubscribeToDeviceStream({
    runtimeMode,
    isVisible,
    attachedDevice,
  });

  const { status: videoStatus, dimensions } = useDeviceVideoStream({
    canvasRef,
    udid: streamEnabled && attachedDevice ? attachedDevice.udid : null,
    enabled: streamEnabled,
  });

  const pickerEntries = useMemo(
    () =>
      buildDevicePickerEntries({
        devices: threadState?.devices ?? [],
        attachedDeviceUdid: threadState?.attachedDeviceUdid ?? null,
      }),
    [threadState?.devices, threadState?.attachedDeviceUdid],
  );

  const runDeviceAction = useCallback(async (action: () => Promise<void>, failureTitle: string) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: failureTitle,
        description: describeDeviceError(error, "The simulator did not respond."),
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const attachDevice = useCallback(
    async (udid: DeviceUdid) => {
      const api = ensureNativeApi();
      upsertThreadState(await api.device.attach({ threadId, udid }));
    },
    [threadId, upsertThreadState],
  );

  const selectDevice = useCallback(
    (entry: (typeof pickerEntries)[number]) => {
      const udid = entry.device.udid;
      if (entry.action.kind === "wait") return;

      setPendingDevice({ device: entry.device, supersedes: reportedUdid });
      void runDeviceAction(async () => {
        try {
          if (entry.action.kind === "boot-then-attach") {
            const result = await ensureNativeApi().device.boot({ udid });
            if (result.kind === "boot-limit-reached") {
              setPendingDevice(null);
              setBootLimit({
                limit: result.limit,
                candidates: result.gladeBooted,
                pendingUdid: udid,
                pendingName: entry.device.name,
              });
              return;
            }
          }
          await attachDevice(udid);
        } catch (error) {
          // The optimistic device would otherwise outlive the failure and leave the pane naming a simulator
          // it never opened.
          setPendingDevice(null);
          throw error;
        }
      }, "Could not open that simulator");
    },
    [attachDevice, reportedUdid, runDeviceAction],
  );

  const shutdownForBootLimit = useCallback(
    (candidate: DeviceDescriptor) => {
      const pending = bootLimit;
      setBootLimit(null);
      if (!pending) return;
      const requested = threadState?.devices.find((device) => device.udid === pending.pendingUdid);

      if (requested) setPendingDevice({ device: requested, supersedes: reportedUdid });
      void runDeviceAction(async () => {
        try {
          const api = ensureNativeApi();
          await api.device.shutdown({ udid: candidate.udid });
          const result = await api.device.boot({ udid: pending.pendingUdid });
          if (result.kind === "boot-limit-reached") {
            setPendingDevice(null);
            setBootLimit({ ...pending, limit: result.limit, candidates: result.gladeBooted });
            return;
          }
          await attachDevice(pending.pendingUdid);
        } catch (error) {
          setPendingDevice(null);
          throw error;
        }
      }, "Could not free a simulator slot");
    },
    [attachDevice, bootLimit, reportedUdid, runDeviceAction, threadState?.devices],
  );

  const detachDevice = useCallback(() => {
    setPendingDevice(null);
    void runDeviceAction(async () => {
      upsertThreadState(await ensureNativeApi().device.detach({ threadId }));
    }, "Could not detach the simulator");
  }, [runDeviceAction, threadId, upsertThreadState]);

  const shutdownAttached = useCallback(() => {
    if (!attachedDevice) return;
    void runDeviceAction(async () => {
      await ensureNativeApi().device.shutdown({ udid: attachedDevice.udid });
    }, "Could not shut down the simulator");
  }, [attachedDevice, runDeviceAction]);

  const pressButton = useCallback(
    (button: DeviceHardwareButton) => {
      if (!attachedDevice) return;
      void runDeviceAction(async () => {
        await ensureNativeApi().device.pressButton({ udid: attachedDevice.udid, button });
      }, "Could not press that button");
    },
    [attachedDevice, runDeviceAction],
  );

  const [recording, setRecording] = useState(createDeviceRecordingState);

  useEffect(() => {
    if (attachedDevice?.state === "booted") return;
    setRecording((state) => stepDeviceRecording(state, { kind: "device-lost" }));
  }, [attachedDevice?.state]);

  const toggleRecording = useCallback(() => {
    if (!attachedDevice) return;
    const intent = deviceRecordingClickIntent(recording);
    if (!intent) return;
    const udid = attachedDevice.udid;
    const api = ensureNativeApi();

    if (intent === "start") {
      setRecording((state) => stepDeviceRecording(state, { kind: "start-requested" }));
      void api.device
        .startRecording({ udid })
        .then((result) => {
          setRecording((state) =>
            stepDeviceRecording(state, {
              kind: "started",
              path: result.path,
              startedAtMs: Date.parse(result.startedAt),
            }),
          );
        })
        .catch((error: unknown) => {
          setRecording((state) => stepDeviceRecording(state, { kind: "failed" }));
          toastManager.add({
            type: "error",
            title: "Could not start recording",
            description: describeDeviceError(error, "The simulator did not start recording."),
          });
        });
      return;
    }

    setRecording((state) => stepDeviceRecording(state, { kind: "stop-requested" }));
    void api.device
      .stopRecording({ udid })
      .then((result) => {
        setRecording((state) => stepDeviceRecording(state, { kind: "stopped" }));
        toastManager.add({
          type: "success",
          title: "Recording saved",
          description: result.path,
          data: { copyText: result.path },
        });
      })
      .catch((error: unknown) => {
        setRecording((state) => stepDeviceRecording(state, { kind: "failed" }));
        toastManager.add({
          type: "error",
          title: "Could not stop recording",
          description: describeDeviceError(error, "The recording may be incomplete."),
        });
      });
  }, [attachedDevice, recording]);

  const saveScreenshot = useCallback(() => {
    if (!attachedDevice) return;
    void runDeviceAction(async () => {
      const shot = await ensureNativeApi().device.screenshot({
        udid: attachedDevice.udid,
        save: true,
      });

      toastManager.add({
        type: "success",
        title: "Screenshot saved",
        description: shot.path ?? shot.name,
        ...(shot.path ? { data: { copyText: shot.path } } : {}),
      });
    }, "Could not save the screenshot");
  }, [attachedDevice, runDeviceAction]);

  const pressRef = useRef<{ point: DevicePoint | null; startedAt: number } | null>(null);

  const [measuredPointSize, setMeasuredPointSize] = useState<{
    readonly width: number;
    readonly height: number;
  } | null>(null);
  const attachedUdid = attachedDevice?.udid ?? null;

  const needsMeasuredPointSize = attachedDevice?.geometry === undefined;

  useEffect(() => {
    setMeasuredPointSize(null);
    if (!attachedUdid || attachedDevice?.state !== "booted" || !needsMeasuredPointSize) return;
    let cancelled = false;
    void ensureNativeApi()
      .device.describeUi({ udid: attachedUdid })
      .then((result) => {
        if (cancelled) return;
        const { width, height } = result.root.frame;
        if (width > 0 && height > 0) setMeasuredPointSize({ width, height });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [attachedUdid, attachedDevice?.state, needsMeasuredPointSize]);

  const devicePointSize = resolveDevicePointSize({
    framePixelWidth: dimensions?.width ?? 0,
    framePixelHeight: dimensions?.height ?? 0,
    geometry: attachedDevice?.geometry,
    measured: measuredPointSize,
  });

  const deviceKind = attachedDevice ? deviceKindFor(attachedDevice) : "iPhone";
  const deviceScale = attachedDevice?.geometry?.scale ?? RESOLUTION_SCALE[deviceKind];
  const devicePixelSize = devicePointSize
    ? {
        width: Math.round(devicePointSize.width * deviceScale),
        height: Math.round(devicePointSize.height * deviceScale),
      }
    : null;

  const pointFromEvent = useCallback(
    (event: { offsetX: number; offsetY: number }): DevicePoint | null => {
      const canvas = canvasRef.current;
      if (!canvas || !dimensions) return null;
      const pointSize = resolveDevicePointSize({
        framePixelWidth: dimensions.width,
        framePixelHeight: dimensions.height,
        geometry: attachedDevice?.geometry,
        measured: measuredPointSize,
      });

      return canvasPointToDevicePoint(
        {
          frameWidth: dimensions.width,
          frameHeight: dimensions.height,
          displayWidth: canvas.clientWidth,
          displayHeight: canvas.clientHeight,
          ...(pointSize
            ? { devicePointWidth: pointSize.width, devicePointHeight: pointSize.height }
            : {}),
        },
        event.offsetX,
        event.offsetY,
      );
    },
    [dimensions, measuredPointSize, attachedDevice?.geometry],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!attachedDevice) return;
      event.currentTarget.setPointerCapture(event.pointerId);

      event.currentTarget.focus();
      pressRef.current = { point: pointFromEvent(event.nativeEvent), startedAt: performance.now() };
    },
    [attachedDevice, pointFromEvent],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const press = pressRef.current;
      pressRef.current = null;
      if (!press || !attachedDevice) return;
      event.currentTarget.releasePointerCapture(event.pointerId);

      const gesture = resolveDevicePointerGesture({
        from: press.point,
        to: pointFromEvent(event.nativeEvent),
        durationMs: performance.now() - press.startedAt,
      });
      if (!gesture) return;

      const api = ensureNativeApi();
      const udid = attachedDevice.udid;
      const sent =
        gesture.kind === "tap"
          ? api.device.tap({ udid, x: gesture.point.x, y: gesture.point.y })
          : api.device.swipe({
              udid,
              fromX: gesture.from.x,
              fromY: gesture.from.y,
              toX: gesture.to.x,
              toY: gesture.to.y,
              durationMs: gesture.durationMs,
            });
      void sent.catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "The simulator did not accept that input",
          description: describeDeviceError(error, "The input could not be delivered."),
        });
      });
    },
    [attachedDevice, pointFromEvent],
  );

  const handleKey = useCallback(
    (event: React.KeyboardEvent<HTMLCanvasElement>, direction: "down" | "up") => {
      if (!attachedDevice) return;

      const hardwareButton = resolveDeviceHardwareButtonShortcut(event);
      if (hardwareButton) {
        event.preventDefault();

        if (direction === "down") pressButton(hardwareButton);
        return;
      }

      if (event.metaKey || event.ctrlKey) return;

      const keyCode = deviceHidUsageForKey(event.key);
      if (keyCode === null) return;
      event.preventDefault();
      void ensureNativeApi()
        .device.keyEvent({
          udid: attachedDevice.udid,
          keyCode,
          modifiers: deviceKeyModifiers(event),
          direction,
        })
        .catch(() => {});
    },
    [attachedDevice, pressButton],
  );

  const deviceControlsDisabled = !attachedDevice || attachedDevice.state !== "booted" || busy;

  const runRailAction = useCallback(
    (action: DeviceRailAction) => {
      switch (action) {
        case "home":
          pressButton("home");
          return;
        case "screenshot":
          saveScreenshot();
          return;
        case "record":
          toggleRecording();
          return;
        case "rotate":
          setLandscape((current) => !current);
          return;
        case "shutdown":
          setShutdownConfirm(true);
          return;
        case "detach":
          detachDevice();
      }
    },
    [detachDevice, pressButton, saveScreenshot, toggleRecording],
  );

  const header = (
    <div className="flex h-full w-full min-w-0 items-center gap-1.5">
      {availabilityView.kind === "blocked" ? (
        <span className="truncate px-2 font-medium text-muted-foreground text-ui leading-snug">
          iOS Simulator
        </span>
      ) : (
        <Menu>
          <MenuTrigger
            render={
              <Button variant="ghost" size="sm" className="min-w-0 gap-1" disabled={busy}>
                <span className="truncate">{attachedDevice?.name ?? "Choose a simulator"}</span>
                <ChevronDownIcon />
              </Button>
            }
          />
          <ComposerPickerMenuPopup align="start">
            {pickerEntries.length === 0 ? (
              <MenuItem disabled>No simulators found</MenuItem>
            ) : (
              pickerEntries.map((entry) => (
                <MenuItem
                  key={entry.device.udid}
                  disabled={entry.action.kind === "wait"}
                  onClick={() => selectDevice(entry)}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate">{entry.device.name}</span>
                    <span className="ml-auto shrink-0 text-muted-foreground text-ui leading-snug">
                      {entry.detail}
                    </span>
                    {entry.attached ? <CheckIcon className="size-3.5 shrink-0" /> : null}
                  </span>
                </MenuItem>
              ))
            )}
            {}
          </ComposerPickerMenuPopup>
        </Menu>
      )}

      {}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={props.onClosePanel}
          title="Close"
          aria-label="Close simulator panel"
        >
          <XIcon />
        </Button>
      </div>
    </div>
  );

  const screen = (() => {
    if (availabilityView.kind === "blocked") {
      const action = resolveDeviceSetupAction(availabilityView.steps);
      return (
        <DeviceSetupScreen
          title={availabilityView.title}
          description={availabilityView.description}
          steps={availabilityView.steps}
          checkingLabel={
            availabilityView.retryable ? deviceSetupCheckingLabel(availabilityView.steps) : null
          }
          footnote={
            availabilityView.steps.length > 0
              ? "Xcode is a free download from Apple and needs about 10 GB of disk space."
              : null
          }
          action={
            action
              ? {
                  label: action.label,
                  onClick: () => {
                    void ensureNativeApi().shell.openExternal(action.url);
                  },
                }
              : null
          }
        />
      );
    }

    if (!attachedDevice) {
      return <DeviceEmptyScreen message="Choose a simulator to start streaming it here." />;
    }

    return (
      <>
        {}
        <canvas
          key={attachedDevice.udid}
          ref={canvasRef}
          tabIndex={0}
          aria-label={`${attachedDevice.name} screen`}
          className={cn(
            "h-full w-full object-cover outline-none ring-inset focus-visible:ring-2 focus-visible:ring-ring/70",
            videoStatus.kind !== "streaming" && "invisible",
          )}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => {
            pressRef.current = null;
          }}
          onKeyDown={(event) => handleKey(event, "down")}
          onKeyUp={(event) => handleKey(event, "up")}
        />
        {runtimeMode === "live" &&
        (videoStatus.kind === "idle" || videoStatus.kind === "connecting") &&
        attachStatusLabel ? (
          <div className="pointer-events-none absolute inset-0">
            <DeviceBootingScreen deviceName={attachedDevice.name} label={attachStatusLabel} />
          </div>
        ) : videoStatus.kind !== "streaming" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-[12%]">
            <DeviceVideoOverlay
              status={videoStatus}
              label={attachStatusLabel ?? "Connecting…"}
              runtimeMode={runtimeMode}
              {...(props.onRequestLive ? { onRequestLive: props.onRequestLive } : {})}
            />
          </div>
        ) : null}
        {}
        {availabilityView.kind === "degraded" ? (
          <p
            role="status"
            className="absolute inset-x-[6%] top-[4%] rounded-full bg-black/70 px-2.5 py-1 text-center text-ui-2xs text-white/75 backdrop-blur-sm"
          >
            {availabilityView.notice}
          </p>
        ) : null}
      </>
    );
  })();

  return (
    <DiffPanelShell mode={props.mode} header={header}>
      {}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-3 py-3">
        <div aria-hidden className={DEVICE_RAIL_HEIGHT_CLASS} />
        <DeviceScreen
          className="min-h-0 w-full flex-1"
          kind={deviceKind}
          pixelWidth={devicePixelSize?.width}
          pixelHeight={devicePixelSize?.height}
          buttonsDisabled={deviceControlsDisabled}
          onPressButton={pressButton}
          landscape={landscape}
        >
          {screen}
        </DeviceScreen>
        {}
        <div className="relative z-10">
          <DeviceControlRail
            disabled={deviceControlsDisabled}
            recording={isDeviceRecordingActive(recording)}
            landscape={landscape}
            onAction={runRailAction}
          />
        </div>
      </div>

      {/* Space is reserved rather than conditionally inserted: a message that appears and clears would
   otherwise resize the bezel's container on every transition. */}
      <p
        role="status"
        className={cn(
          "line-clamp-2 flex shrink-0 items-center px-3 text-destructive text-ui leading-snug transition-opacity duration-120 motion-reduce:transition-none",
          threadState?.lastError
            ? "border-border border-t opacity-100"
            : "border-transparent border-t opacity-0",
        )}
        style={{ height: "1.875rem" }}
      >
        {threadState?.lastError ?? ""}
      </p>

      <DeviceBootLimitDialog
        state={bootLimit}
        deviceName={bootLimit?.pendingName ?? "that simulator"}
        onDismiss={() => setBootLimit(null)}
        onShutdown={shutdownForBootLimit}
      />

      {}
      <AlertDialog open={shutdownConfirm} onOpenChange={setShutdownConfirm}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Shut down {attachedDevice?.name ?? "this simulator"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Anything running on the simulator closes. Booting it again takes about a minute.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setShutdownConfirm(false);
                shutdownAttached();
              }}
            >
              Shut down
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </DiffPanelShell>
  );
}

function DeviceVideoOverlay(props: {
  status: ReturnType<typeof useDeviceVideoStream>["status"];

  label: string;
  runtimeMode: DockPaneRuntimeMode;
  onRequestLive?: () => void;
}) {
  const { status } = props;

  if (props.runtimeMode === "preview") {
    return (
      <button
        type="button"
        className="pointer-events-auto rounded-full bg-white/95 px-3 py-1.5 font-medium text-ui-xs text-black"
        onClick={props.onRequestLive}
      >
        Show the live simulator
      </button>
    );
  }

  if (status.kind === "unsupported") {
    return (
      <p className="text-balance text-center text-ui-xs text-white/70 leading-snug">
        This browser cannot decode the simulator stream. Chrome, Edge, or Safari 17+ support the
        WebCodecs video decoder Glade uses.
      </p>
    );
  }

  if (status.kind === "error") {
    return (
      <p className="text-balance text-center text-ui-xs text-white/70 leading-snug">
        {status.message}
      </p>
    );
  }

  return (
    <span className="flex items-center gap-1.5 text-ui-xs text-white/45">
      <LoaderCircleIcon className="size-3 animate-spin motion-reduce:animate-none" />
      {props.label}
    </span>
  );
}

function DeviceBootLimitDialog(props: {
  state: {
    readonly limit: number;
    readonly candidates: readonly DeviceDescriptor[];
  } | null;

  deviceName: string;
  onDismiss: () => void;
  onShutdown: (candidate: DeviceDescriptor) => void;
}) {
  const { state } = props;

  return (
    <Dialog open={state !== null} onOpenChange={(open) => (open ? undefined : props.onDismiss())}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Shut down a simulator to start {props.deviceName}</DialogTitle>
          {}
          <DialogDescription>
            Glade keeps at most {state?.limit ?? 0} simulators running at once, because each one
            holds a few gigabytes of memory. Pick one to shut down — anything running on it closes —
            and {props.deviceName} starts in its place.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1">
          {(state?.candidates ?? []).map((candidate) => (
            <li key={candidate.udid}>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-between"
                onClick={() => props.onShutdown(candidate)}
              >
                <span className="truncate">Shut down {candidate.name}</span>
                <span className="shrink-0 text-muted-foreground text-ui leading-snug">
                  {candidate.runtime}
                </span>
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={props.onDismiss}>
            Keep them all running
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
