import "@xterm/xterm/css/xterm.css";
import { SearchAddon } from "@xterm/addon-search";
import { TriangleAlertIcon } from "~/lib/icons";
import { type ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  type TerminalActivityState,
  type TerminalCliKind,
} from "@glade/shared/threads/terminalThreads";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type TerminalContextSelection } from "~/lib/terminalContext";
import { readNativeApi } from "~/nativeApi";
import type { ThreadTerminalPresentationMode } from "../types";
import { cn } from "~/lib/utils";
import { resolveTerminalVisualIdentityMap } from "../terminalVisualIdentity";
import {
  resolveTerminalSelectionActionPosition,
  resolveTerminalSelectionContextMenuItems,
  shouldHandleTerminalSelectionMouseUp,
  terminalSelectionActionDelayForClickCount,
} from "./terminal/terminalSelectionActions";
import { buildTerminalRuntimeKey } from "./terminal/terminalRuntimeTypes";
import { terminalRuntimeRegistry } from "./terminal/terminalRuntimeRegistry";
import type {
  TerminalRuntimeConfig,
  TerminalRuntimeStatus,
  TerminalRuntimeViewState,
} from "./terminal/terminalRuntimeTypes";
import { useTerminalDrawerHeight } from "./terminal/useTerminalDrawerHeight";
import { TerminalSearch } from "./TerminalSearch";
import { TerminalScrollToBottom } from "./TerminalScrollToBottom";

function serializeRuntimeEnv(runtimeEnv: Record<string, string> | undefined): string {
  if (!runtimeEnv) return "";
  const entries = Object.entries(runtimeEnv);
  if (entries.length === 0) return "";
  entries.sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(entries);
}

function runtimeEnvFromSerialized(
  serializedRuntimeEnv: string,
): Record<string, string> | undefined {
  if (!serializedRuntimeEnv) return undefined;
  const entries = JSON.parse(serializedRuntimeEnv) as Array<[string, string]>;
  return Object.fromEntries(entries);
}

function getTerminalSelectionRect(mountElement: HTMLElement): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const commonAncestor = range.commonAncestorContainer;
  const selectionRoot =
    commonAncestor instanceof Element ? commonAncestor : commonAncestor.parentElement;
  if (!(selectionRoot instanceof Element) || !mountElement.contains(selectionRoot)) {
    return null;
  }

  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 || rect.height > 0,
  );
  if (rects.length > 0) {
    return rects[rects.length - 1] ?? null;
  }

  const boundingRect = range.getBoundingClientRect();
  return boundingRect.width > 0 || boundingRect.height > 0 ? boundingRect : null;
}

function TerminalRuntimeStatusOverlay({ status }: { status: TerminalRuntimeStatus }) {
  if (status !== "error") return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute left-1 top-1 z-10 inline-flex h-6 max-w-[calc(100%-0.5rem)] items-center gap-1.5 rounded border px-2 text-ui-sm leading-none shadow-sm backdrop-blur",
        "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      <TriangleAlertIcon className="size-3" />
      <span className="truncate">Error</span>
    </div>
  );
}

interface TerminalViewportProps {
  threadId: ThreadId;
  terminalId: string;
  terminalLabel: string;
  terminalCliKind?: TerminalCliKind | null;
  cwd: string;
  runtimeEnv?: Record<string, string>;
  onSessionExited: () => void;
  onTerminalMetadataChange: (
    terminalId: string,
    metadata: { cliKind: TerminalCliKind | null; label: string },
  ) => void;
  onTerminalActivityChange: (
    terminalId: string,
    activity: { hasRunningSubprocess: boolean; agentState: TerminalActivityState | null },
  ) => void;
  onAddTerminalContext?: ((selection: TerminalContextSelection) => void) | undefined;
  focusRequestId: number;
  autoFocus: boolean;
  isVisible: boolean;
}

function TerminalViewport({
  threadId,
  terminalId,
  terminalLabel,
  terminalCliKind: terminalCliKindProp,
  cwd,
  runtimeEnv,
  onSessionExited,
  onTerminalMetadataChange,
  onTerminalActivityChange,
  onAddTerminalContext,
  focusRequestId,
  autoFocus,
  isVisible,
}: TerminalViewportProps) {
  const terminalCliKind = terminalCliKindProp ?? null;
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const onAddTerminalContextRef = useRef(onAddTerminalContext);
  const terminalLabelRef = useRef(terminalLabel);
  const selectionPointerRef = useRef<{ x: number; y: number } | null>(null);
  const selectionGestureActiveRef = useRef(false);
  const selectionActionRequestIdRef = useRef(0);
  const selectionActionOpenRef = useRef(false);
  const selectionActionTimerRef = useRef<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [terminalInstance, setTerminalInstance] = useState<Terminal | null>(null);
  const [searchAddonInstance, setSearchAddonInstance] = useState<SearchAddon | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<TerminalRuntimeStatus>("connecting");
  const runtimeStatusMountedRef = useRef(false);
  const trimmedCwd = useMemo(() => cwd.trim(), [cwd]);
  const runtimeCwdReady = trimmedCwd.length > 0;
  const runtimeKey = useMemo(
    () => buildTerminalRuntimeKey(threadId, terminalId),
    [terminalId, threadId],
  );
  const runtimeEnvSerialized = useMemo(() => serializeRuntimeEnv(runtimeEnv), [runtimeEnv]);
  const runtimeEnvPayload = useMemo(
    () => runtimeEnvFromSerialized(runtimeEnvSerialized),
    [runtimeEnvSerialized],
  );
  const runtimeConfig = useMemo<TerminalRuntimeConfig>(
    () => ({
      runtimeKey,
      threadId,
      terminalId,
      terminalLabel,
      terminalCliKind,
      cwd,
      ...(runtimeEnvPayload ? { runtimeEnv: runtimeEnvPayload } : {}),
      callbacks: {
        onSessionExited,
        onTerminalMetadataChange,
        onTerminalActivityChange,
        onTerminalRuntimeStatusChange: (changedTerminalId, status) => {
          if (changedTerminalId === terminalId && runtimeStatusMountedRef.current) {
            setRuntimeStatus(status);
          }
        },
      },
    }),
    [
      cwd,
      onSessionExited,
      onTerminalActivityChange,
      onTerminalMetadataChange,
      runtimeEnvPayload,
      runtimeKey,
      terminalCliKind,
      terminalId,
      terminalLabel,
      threadId,
    ],
  );
  const runtimeViewState = useMemo<TerminalRuntimeViewState>(
    () => ({ autoFocus, isVisible }),
    [autoFocus, isVisible],
  );
  const runtimeConfigRef = useRef(runtimeConfig);
  const runtimeViewStateRef = useRef(runtimeViewState);

  useLayoutEffect(() => {
    onAddTerminalContextRef.current = onAddTerminalContext;
  }, [onAddTerminalContext]);

  useEffect(() => {
    runtimeStatusMountedRef.current = true;
    return () => {
      runtimeStatusMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    runtimeConfigRef.current = runtimeConfig;
  }, [runtimeConfig]);

  useEffect(() => {
    runtimeViewStateRef.current = runtimeViewState;
  }, [runtimeViewState]);

  useEffect(() => {
    terminalLabelRef.current = terminalLabel;
  }, [terminalLabel]);

  useEffect(() => {
    const mount = containerRef.current;
    if (!mount || !runtimeCwdReady) {
      terminalRef.current = null;
      setTerminalInstance(null);
      setSearchAddonInstance(null);
      setRuntimeStatus("connecting");
      return;
    }
    const attachedRuntime = terminalRuntimeRegistry.attach(
      runtimeConfigRef.current,
      runtimeViewStateRef.current,
      mount,
    );

    terminalRef.current = attachedRuntime.terminal;
    setTerminalInstance(attachedRuntime.terminal);
    setSearchAddonInstance(attachedRuntime.searchAddon);
    setRuntimeStatus(attachedRuntime.runtimeStatus);

    return () => {
      if (selectionActionTimerRef.current !== null) {
        window.clearTimeout(selectionActionTimerRef.current);
        selectionActionTimerRef.current = null;
      }
      selectionActionOpenRef.current = false;
      terminalRuntimeRegistry.detach(runtimeKey);
      terminalRef.current = null;
      setTerminalInstance(null);
      setSearchAddonInstance(null);
    };
  }, [runtimeCwdReady, runtimeKey]);

  useEffect(() => {
    if (!runtimeCwdReady) return;
    terminalRuntimeRegistry.syncConfig(runtimeKey, runtimeConfig);
  }, [runtimeConfig, runtimeCwdReady, runtimeKey]);

  useEffect(() => {
    if (!runtimeCwdReady) return;
    terminalRuntimeRegistry.setViewState(runtimeKey, runtimeViewState);
  }, [runtimeCwdReady, runtimeKey, runtimeViewState]);

  useEffect(() => {
    if (!autoFocus || !runtimeCwdReady) return;
    terminalRuntimeRegistry.focus(runtimeKey);
  }, [autoFocus, focusRequestId, runtimeCwdReady, runtimeKey]);

  useEffect(() => {
    const mount = containerRef.current;
    if (!mount) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === "f" &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        event.stopPropagation();
        setSearchOpen(true);
      }
    };

    mount.addEventListener("keydown", handleKeyDown, true);
    return () => {
      mount.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  const clearSelectionAction = useCallback(() => {
    selectionActionRequestIdRef.current += 1;
    if (selectionActionTimerRef.current !== null) {
      window.clearTimeout(selectionActionTimerRef.current);
      selectionActionTimerRef.current = null;
    }
  }, []);

  const readSelectionAction = useCallback((): {
    position: { x: number; y: number };
    selection: TerminalContextSelection;
  } | null => {
    const activeTerminal = terminalRef.current;
    const mountElement = containerRef.current;
    if (!activeTerminal || !mountElement || !activeTerminal.hasSelection()) {
      return null;
    }
    const selectionText = activeTerminal.getSelection();
    const selectionPosition = activeTerminal.getSelectionPosition();
    const normalizedText = selectionText.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
    if (!selectionPosition || normalizedText.length === 0) {
      return null;
    }
    const lineStart = selectionPosition.start.y + 1;
    const lineCount = normalizedText.split("\n").length;
    const lineEnd = Math.max(lineStart, lineStart + lineCount - 1);
    const bounds = mountElement.getBoundingClientRect();
    const selectionRect = getTerminalSelectionRect(mountElement);
    const position = resolveTerminalSelectionActionPosition({
      bounds,
      selectionRect:
        selectionRect === null
          ? null
          : { right: selectionRect.right, bottom: selectionRect.bottom },
      pointer: selectionPointerRef.current,
    });
    return {
      position,
      selection: {
        terminalId,
        terminalLabel: terminalLabelRef.current,
        lineStart,
        lineEnd,
        text: normalizedText,
      },
    };
  }, [terminalId]);

  const showSelectionAction = useCallback(() => {
    if (selectionActionOpenRef.current) {
      return;
    }
    const contextMenuItems = resolveTerminalSelectionContextMenuItems(
      onAddTerminalContextRef.current !== undefined,
    );
    if (contextMenuItems.length === 0) {
      clearSelectionAction();
      return;
    }
    const nextAction = readSelectionAction();
    if (!nextAction) {
      clearSelectionAction();
      return;
    }
    const api = readNativeApi();
    if (!api) return;
    const requestId = ++selectionActionRequestIdRef.current;
    selectionActionOpenRef.current = true;

    void api.contextMenu
      .show(contextMenuItems, nextAction.position)
      .then((clicked) => {
        if (requestId !== selectionActionRequestIdRef.current || clicked !== "add-to-chat") {
          return;
        }
        const addTerminalContext = onAddTerminalContextRef.current;
        if (!addTerminalContext) {
          return;
        }
        addTerminalContext(nextAction.selection);
        terminalRef.current?.clearSelection();
        terminalRuntimeRegistry.focus(runtimeKey);
      })
      .finally(() => {
        selectionActionOpenRef.current = false;
      });
  }, [clearSelectionAction, readSelectionAction, runtimeKey]);

  useEffect(() => {
    const terminal = terminalInstance;
    const mount = containerRef.current;
    if (!terminal || !mount) return;

    const selectionDisposable = terminal.onSelectionChange(() => {
      if (terminal.hasSelection()) {
        return;
      }
      clearSelectionAction();
    });

    const handleMouseUp = (event: MouseEvent) => {
      const shouldHandle = shouldHandleTerminalSelectionMouseUp(
        selectionGestureActiveRef.current,
        event.button,
      );
      selectionGestureActiveRef.current = false;
      if (!shouldHandle) {
        return;
      }
      selectionPointerRef.current = { x: event.clientX, y: event.clientY };
      const delay = terminalSelectionActionDelayForClickCount(event.detail);
      selectionActionTimerRef.current = window.setTimeout(() => {
        selectionActionTimerRef.current = null;
        window.requestAnimationFrame(() => {
          void showSelectionAction();
        });
      }, delay);
    };

    const handlePointerDown = (event: PointerEvent) => {
      clearSelectionAction();
      selectionGestureActiveRef.current = event.button === 0;
    };

    window.addEventListener("mouseup", handleMouseUp);
    mount.addEventListener("pointerdown", handlePointerDown);
    return () => {
      selectionDisposable.dispose();
      window.removeEventListener("mouseup", handleMouseUp);
      mount.removeEventListener("pointerdown", handlePointerDown);
      clearSelectionAction();
      selectionGestureActiveRef.current = false;
    };
  }, [clearSelectionAction, showSelectionAction, terminalInstance]);

  return (
    <div className="h-full min-h-0 w-full bg-[var(--color-background-surface)] p-3">
      <div className="relative h-full min-h-0 w-full overflow-hidden">
        <TerminalSearch
          searchAddon={searchAddonInstance}
          isOpen={searchOpen}
          onClose={() => {
            setSearchOpen(false);
            terminalRuntimeRegistry.focus(runtimeKey);
          }}
        />
        <TerminalRuntimeStatusOverlay status={runtimeStatus} />
        <TerminalScrollToBottom terminal={terminalInstance} />
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  );
}

interface ThreadTerminalDrawerProps {
  threadId: ThreadId;
  cwd: string;
  runtimeEnv?: Record<string, string>;
  height: number;
  presentationMode: ThreadTerminalPresentationMode;
  isVisible?: boolean;
  terminalIds: string[];
  terminalLabelsById: Record<string, string>;
  terminalTitleOverridesById: Record<string, string>;
  terminalCliKindsById: Record<string, TerminalCliKind>;
  terminalAttentionStatesById: Record<string, "attention" | "review">;
  runningTerminalIds: string[];
  activeTerminalId: string;
  focusRequestId: number;
  onTerminalSessionExited: (terminalId: string) => void;
  onHeightChange: (height: number) => void;
  onTerminalMetadataChange: (
    terminalId: string,
    metadata: { cliKind: TerminalCliKind | null; label: string },
  ) => void;
  onTerminalActivityChange: (
    terminalId: string,
    activity: { hasRunningSubprocess: boolean; agentState: TerminalActivityState | null },
  ) => void;
  onAddTerminalContext?: ((selection: TerminalContextSelection) => void) | undefined;
}
export default function ThreadTerminalDrawer(props: ThreadTerminalDrawerProps) {
  const isWorkspaceMode = props.presentationMode === "workspace";
  const {
    drawerRef,
    drawerHeight,
    handleResizePointerDown,
    handleResizePointerMove,
    handleResizePointerEnd,
  } = useTerminalDrawerHeight({
    height: props.height,
    onHeightChange: props.onHeightChange,
    resetKey: props.threadId,
  });
  const terminalVisualIdentityById = resolveTerminalVisualIdentityMap(props);
  const previousRuntimeKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const next = new Set(
      props.terminalIds.map((id) => buildTerminalRuntimeKey(props.threadId, id)),
    );
    for (const key of previousRuntimeKeysRef.current)
      if (!next.has(key)) terminalRuntimeRegistry.dispose(key);
    previousRuntimeKeysRef.current = next;
  }, [props.terminalIds, props.threadId]);
  return (
    <aside
      ref={drawerRef}
      className={cn(
        "thread-terminal-drawer relative flex w-full min-w-0 flex-col overflow-hidden bg-[var(--color-background-surface)]",
        isWorkspaceMode ? "h-full min-h-0" : "shrink-0 border-t border-border/70",
      )}
      style={isWorkspaceMode ? undefined : { height: drawerHeight }}
    >
      {!isWorkspaceMode ? (
        <div
          className="absolute inset-x-0 top-0 z-20 h-1.5 cursor-row-resize"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerEnd}
          onPointerCancel={handleResizePointerEnd}
        />
      ) : null}
      <div className="relative min-h-0 flex-1">
        {props.terminalIds.map((terminalId) => {
          const active = terminalId === props.activeTerminalId;
          const identity = terminalVisualIdentityById.get(terminalId);
          return (
            <div
              key={terminalId}
              className={cn("absolute inset-0", !active && "invisible pointer-events-none")}
              inert={!active}
              aria-hidden={!active}
            >
              <TerminalViewport
                threadId={props.threadId}
                terminalId={terminalId}
                terminalLabel={identity?.title ?? "Terminal"}
                terminalCliKind={identity?.cliKind ?? null}
                cwd={props.cwd}
                {...(props.runtimeEnv ? { runtimeEnv: props.runtimeEnv } : {})}
                onSessionExited={() => props.onTerminalSessionExited(terminalId)}
                onTerminalMetadataChange={props.onTerminalMetadataChange}
                onTerminalActivityChange={props.onTerminalActivityChange}
                onAddTerminalContext={props.onAddTerminalContext}
                focusRequestId={props.focusRequestId}
                autoFocus={active}
                isVisible={(props.isVisible ?? true) && active}
              />
            </div>
          );
        })}
      </div>
    </aside>
  );
}
