"use client";

import {
  AlertCircleIcon,
  CircleCheckIcon,
  CheckIcon,
  Copy01Icon,
  InfoIcon,
  TriangleAlertIcon,
  XIcon,
} from "~/lib/icons";
import type { IconComponent } from "~/lib/iconComponent";
import { Spinner } from "~/components/ui/spinner";
import { Toast, type ToastObject } from "@base-ui/react/toast";
import { useEffect, useState, type CSSProperties } from "react";
import { useParams } from "@tanstack/react-router";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { useCopyToClipboard } from "../../lib/clipboard";
import {
  buildVisibleToastLayout,
  DEFAULT_TOAST_TIMEOUT_MS,
  shouldHideCollapsedToastContent,
  shouldRunVisibleToastAutoDismiss,
} from "./toast.logic";
import {
  NOTIFICATION_ICON_CLASS_NAME,
  toastSurfaceClassName,
  type NotificationTone,
} from "./notificationSurface";
import {
  resolveVisibleToastThreadIds,
  shouldRenderToastForVisibleThreads,
} from "./toastRouteVisibility";

interface ToastAction {
  label: string;
  icon: IconComponent;
  // Returning a promise holds the toast (actions and dismissal disabled, visible timer paused)
  // until it settles; resolving `true` closes the toast.
  onClick: () => void | Promise<boolean>;
  destructive?: boolean;
}
type ThreadToastData = {
  actions?: readonly ToastAction[];
  allowCrossThreadVisibility?: boolean;
  copyText?: string;
  onClose?: () => void;
  threadId?: ThreadId | null;
  dismissAfterVisibleMs?: number;
};
const toastManager = Toast.createToastManager<ThreadToastData>();
const anchoredToastManager = Toast.createToastManager();
type ToastId = ReturnType<typeof toastManager.add>;
const threadToastVisibleTimeoutRemainingMs = new Map<ToastId, number>();

function SidebarSpinner({ className }: { className?: string }) {
  return <Spinner variant="action" className={className} aria-hidden="true" />;
}
const TOAST_ICONS: Record<NotificationTone, IconComponent | typeof SidebarSpinner> = {
  error: AlertCircleIcon,
  info: InfoIcon,
  neutral: SidebarSpinner,
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
};
function toastTone(type: string | undefined): NotificationTone {
  switch (type) {
    case "error":
    case "success":
    case "warning":
      return type;
    case "loading":
      return "neutral";
    default:
      return "info";
  }
}

// Actions keep the toast's secondary text size instead of the button's own `xs` text. Destructive
// actions drop the opaque fill of `destructive-outline` so they sit on the toast tint like the rest.
const TOAST_ACTION_BUTTON_CLASS_NAME = "gap-1.5 font-sans font-medium text-ui-sm sm:text-ui-sm";

type ToastPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";
interface ToastProviderProps extends Toast.Provider.Props {
  position?: ToastPosition;
}
function shouldRenderForActiveThread(
  data: ThreadToastData | undefined,
  visibleThreadIds: ReadonlySet<ThreadId>,
): boolean {
  return shouldRenderToastForVisibleThreads({
    allowCrossThreadVisibility: data?.allowCrossThreadVisibility,
    toastThreadId: data?.threadId,
    visibleThreadIds,
  });
}
function useVisibleThreadIdsFromRoute(): ReadonlySet<ThreadId> {
  const activeThreadId = useParams({
    strict: false,
    select: (params) =>
      typeof params.threadId === "string" ? ThreadId.makeUnsafe(params.threadId) : null,
  });
  return resolveVisibleToastThreadIds(activeThreadId);
}
function ThreadToastVisibleAutoDismiss({
  toast,
  dismissAfterVisibleMs,
  paused,
}: {
  toast: ToastObject<ThreadToastData>;
  dismissAfterVisibleMs: number | undefined;
  // While paused (an action is in flight) the visible timer holds so the toast can't
  // auto-dismiss out from under an action the user just triggered.
  paused: boolean;
}) {
  const toastId = toast.id;
  const toastRef = toast.ref;
  useEffect(() => {
    if (!dismissAfterVisibleMs || dismissAfterVisibleMs <= 0) return;
    if (typeof window === "undefined" || typeof document === "undefined") return;
    let remainingMs = threadToastVisibleTimeoutRemainingMs.get(toastId) ?? dismissAfterVisibleMs;
    let startedAtMs: number | null = null;
    let timeoutId: number | null = null;
    let closed = false;
    let disposed = false;
    const clearTimer = () => {
      if (timeoutId === null) return;
      window.clearTimeout(timeoutId);
      timeoutId = null;
    };
    const toastHasFocus = () => {
      const toastElement = toastRef?.current;
      const activeElement = document.activeElement;
      return Boolean(toastElement && activeElement && toastElement.contains(activeElement));
    };
    const closeToast = () => {
      if (closed) return;
      closed = true;
      threadToastVisibleTimeoutRemainingMs.delete(toastId);
      toastManager.close(toastId);
    };
    const pause = () => {
      if (startedAtMs === null) return;
      remainingMs = Math.max(0, remainingMs - (Date.now() - startedAtMs));
      startedAtMs = null;
      clearTimer();
      threadToastVisibleTimeoutRemainingMs.set(toastId, remainingMs);
    };
    const start = () => {
      if (closed || startedAtMs !== null) return;
      if (remainingMs <= 0) {
        closeToast();
        return;
      }
      startedAtMs = Date.now();
      clearTimer();
      timeoutId = window.setTimeout(() => {
        remainingMs = 0;
        startedAtMs = null;
        closeToast();
      }, remainingMs);
    };
    const syncTimer = () => {
      // Focus events settle in a microtask, possibly after this effect was
      // cleaned up by navigation or an in-flight action changing `paused`.
      if (disposed) return;
      const shouldRun = shouldRunVisibleToastAutoDismiss({
        paused,
        documentVisible: document.visibilityState === "visible",
        windowFocused: document.hasFocus(),
        toastFocused: toastHasFocus(),
      });
      if (shouldRun) {
        start();
        return;
      }
      pause();
    };
    const syncTimerAfterFocusChange = () => {
      window.queueMicrotask(syncTimer);
    };
    syncTimer();
    document.addEventListener("visibilitychange", syncTimer);
    document.addEventListener("focusin", syncTimerAfterFocusChange);
    document.addEventListener("focusout", syncTimerAfterFocusChange);
    window.addEventListener("focus", syncTimer);
    window.addEventListener("blur", syncTimer);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", syncTimer);
      document.removeEventListener("focusin", syncTimerAfterFocusChange);
      document.removeEventListener("focusout", syncTimerAfterFocusChange);
      window.removeEventListener("focus", syncTimer);
      window.removeEventListener("blur", syncTimer);
      pause();
      clearTimer();
    };
  }, [dismissAfterVisibleMs, toastId, toastRef, paused]);
  return null;
}
function ToastActionButton({
  action,
  disabled,
  onClick,
}: {
  action: Pick<ToastAction, "label" | "icon" | "destructive">;
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = action.icon;
  return (
    <Button
      className={cn(TOAST_ACTION_BUTTON_CLASS_NAME, action.destructive && "bg-transparent")}
      data-base-ui-swipe-ignore
      data-slot="toast-action"
      disabled={disabled}
      onClick={onClick}
      size="xs"
      variant={action.destructive ? "destructive-outline" : "outline"}
    >
      <Icon />
      <span>{action.label}</span>
    </Button>
  );
}
function ToastCopyButton({ copyText, disabled }: { copyText: string; disabled: boolean }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  return (
    <ToastActionButton
      action={{ label: isCopied ? "Copied" : "Copy", icon: isCopied ? CheckIcon : Copy01Icon }}
      disabled={disabled}
      onClick={() => copyToClipboard(copyText, undefined)}
    />
  );
}
function ToastCloseButton({
  disabled,
  onClose,
}: {
  disabled: boolean;
  onClose: (() => void) | undefined;
}) {
  return (
    <Toast.Close
      aria-label="Dismiss toast"
      className={cn(
        // pointer-events-auto keeps the X clickable even when a stacked/collapsed
        // toast still gates its content with pointer-events-none.
        "pointer-events-auto z-10 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[var(--notification-fg)]/65 transition-colors hover:bg-[var(--notification-fg)]/10 hover:text-[var(--notification-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--notification-fg)]/35 disabled:pointer-events-none disabled:cursor-default disabled:opacity-35",
      )}
      data-slot="toast-close"
      disabled={disabled}
      onClick={() => {
        onClose?.();
      }}
      title="Dismiss toast"
    >
      <XIcon className="size-3" />
    </Toast.Close>
  );
}
function blurFocusedToastElement(toast: ToastObject<ThreadToastData>) {
  if (typeof document === "undefined") return;
  const toastElement = toast.ref?.current;
  const activeElement = document.activeElement;
  if (
    toastElement &&
    activeElement instanceof HTMLElement &&
    toastElement.contains(activeElement)
  ) {
    activeElement.blur();
  }
}
function ToastSurface({
  toast,
  hideCollapsedContent,
}: {
  toast: ToastObject<ThreadToastData>;
  hideCollapsedContent: boolean;
}) {
  const [actionPending, setActionPending] = useState(false);
  const Icon = TOAST_ICONS[toastTone(toast.type)];
  const actions = toast.data?.actions ?? [];
  const copyText = toast.data?.copyText;
  const runAction = (action: ToastAction) => {
    if (actionPending) return;
    const result = action.onClick();
    if (!result) return;
    setActionPending(true);
    result.then(
      (close) => {
        if (!close) {
          setActionPending(false);
          return;
        }
        blurFocusedToastElement(toast);
        toastManager.close(toast.id);
      },
      () => setActionPending(false),
    );
  };
  return (
    <>
      <ThreadToastVisibleAutoDismiss
        dismissAfterVisibleMs={toast.data?.dismissAfterVisibleMs}
        paused={actionPending}
        toast={toast}
      />
      <Toast.Content
        className={cn(
          "pointer-events-auto relative flex items-start gap-2.5 overflow-hidden py-2.5 pr-2 pl-3 text-ui leading-normal transition-opacity duration-(--ui-motion-long-duration) ease-out motion-reduce:transition-none data-expanded:opacity-100",
          hideCollapsedContent &&
            "not-data-expanded:pointer-events-none not-data-expanded:opacity-0",
        )}
      >
        <div
          className="flex h-lh shrink-0 items-center [&_svg]:pointer-events-none"
          data-slot="toast-icon"
        >
          <Icon className={cn("size-4", NOTIFICATION_ICON_CLASS_NAME)} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Toast.Title
            className="line-clamp-2 min-w-0 font-medium [overflow-wrap:anywhere]"
            data-slot="toast-title"
          />
          <Toast.Description
            className="line-clamp-4 min-w-0 text-ui-sm text-[var(--notification-fg)]/72 [overflow-wrap:anywhere]"
            data-slot="toast-description"
          />
          {actions.length > 0 || copyText ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {actions.map((action) => (
                <ToastActionButton
                  action={action}
                  disabled={actionPending}
                  key={action.label}
                  onClick={() => runAction(action)}
                />
              ))}
              {copyText ? <ToastCopyButton copyText={copyText} disabled={actionPending} /> : null}
            </div>
          ) : null}
        </div>
        <div className="flex h-lh shrink-0 items-center">
          <ToastCloseButton disabled={actionPending} onClose={toast.data?.onClose} />
        </div>
      </Toast.Content>
    </>
  );
}
function ToastProvider({
  children,
  position: positionProp,
  timeout = DEFAULT_TOAST_TIMEOUT_MS,
  ...props
}: ToastProviderProps) {
  const position = positionProp ?? "top-center";
  return (
    <Toast.Provider timeout={timeout} toastManager={toastManager} {...props}>
      {children}
      <Toasts position={position} />
    </Toast.Provider>
  );
}
function Toasts({ position: positionProp }: { position: ToastPosition }) {
  const position = positionProp ?? "top-center";
  const { toasts } = Toast.useToastManager<ThreadToastData>();
  const visibleThreadIds = useVisibleThreadIdsFromRoute();
  const isTop = position.startsWith("top");
  const visibleToasts = toasts
    .filter((toast) => shouldRenderForActiveThread(toast.data, visibleThreadIds))
    .toSorted((left, right) => {
      const leftEnding = left.transitionStatus === "ending";
      const rightEnding = right.transitionStatus === "ending";
      if (leftEnding === rightEnding) return 0;
      return leftEnding ? 1 : -1;
    });
  const visibleToastLayout = buildVisibleToastLayout(visibleToasts);
  useEffect(() => {
    const activeToastIds = new Set(toasts.map((toast) => toast.id));
    for (const toastId of threadToastVisibleTimeoutRemainingMs.keys()) {
      if (!activeToastIds.has(toastId)) {
        threadToastVisibleTimeoutRemainingMs.delete(toastId);
      }
    }
  }, [toasts]);
  return (
    <Toast.Portal data-slot="toast-portal">
      <Toast.Viewport
        className={cn(
          "fixed z-[200] mx-auto flex w-[calc(100%-var(--toast-inset)*2)] max-w-sm [--toast-inset:--spacing(4)] sm:[--toast-inset:--spacing(8)]",
          // Vertical positioning
          "data-[position=top-center]:top-4",
          "data-[position=top-left]:top-[calc(var(--toast-inset)+46px)]",
          "data-[position=top-right]:top-[calc(var(--toast-inset)+46px)]",
          "data-[position*=bottom]:bottom-(--toast-inset)",
          // Horizontal positioning
          "data-[position*=left]:left-(--toast-inset)",
          "data-[position*=right]:right-(--toast-inset)",
          "data-[position*=center]:-translate-x-1/2 data-[position*=center]:left-1/2",
        )}
        data-position={position}
        data-slot="toast-viewport"
        style={
          {
            "--toast-frontmost-height": `${visibleToastLayout.frontmostHeight}px`,
          } as CSSProperties
        }
      >
        {visibleToastLayout.items.map(({ toast, visibleIndex, offsetY }) => {
          const hideCollapsedContent = shouldHideCollapsedToastContent(
            visibleIndex,
            visibleToastLayout.items.length,
          );
          return (
            <Toast.Root
              className={cn(
                "absolute z-[calc(9999-var(--toast-index))] h-(--toast-calc-height) select-none transition-[transform,opacity,height] duration-(--ui-motion-long-duration) ease-out motion-reduce:transition-none",
                toastSurfaceClassName(toastTone(toast.type)),
                position.includes("center") && "mx-auto",
                // Base positioning using data-position
                "data-[position*=right]:right-0 data-[position*=right]:left-auto",
                "data-[position*=left]:right-auto data-[position*=left]:left-0",
                "data-[position*=center]:right-0 data-[position*=center]:left-0",
                "data-[position*=top]:top-0 data-[position*=top]:bottom-auto data-[position*=top]:origin-top",
                "data-[position*=bottom]:top-auto data-[position*=bottom]:bottom-0 data-[position*=bottom]:origin-bottom",
                // Gap fill for hover
                "after:absolute after:left-0 after:h-[calc(var(--toast-gap)+1px)] after:w-full",
                "data-[position*=top]:after:top-full",
                "data-[position*=bottom]:after:bottom-full",
                // Define some variables
                // Base UI exposes a shared front-most height for the collapsed stack.
                // If that shared measurement is briefly stale, long content can render
                // outside the card until hover expands the toast and swaps to its own height.
                "[--toast-calc-height:max(var(--toast-frontmost-height,var(--toast-height)),var(--toast-height))] [--toast-gap:--spacing(3)] [--toast-peek:--spacing(3)] [--toast-scale:calc(max(0,1-(var(--toast-index)*.1)))] [--toast-shrink:calc(1-var(--toast-scale))]",
                // Top-center uses a flat banner stack without peek/shrink offsets.
                "data-[position=top-center]:[--toast-peek:0px] data-[position=top-center]:[--toast-scale:1] data-[position=top-center]:[--toast-shrink:0]",
                "data-[position=top-center]:transform-[translateX(var(--toast-swipe-movement-x))_translateY(var(--toast-swipe-movement-y))]",
                "data-[position=top-center]:data-expanded:transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-offset-y)+var(--toast-swipe-movement-y)))]",
                // Flat stacks have no peek; wider inactive surfaces must disappear too.
                hideCollapsedContent &&
                  "data-[position=top-center]:not-data-expanded:invisible data-[position=top-center]:not-data-expanded:pointer-events-none data-[position=top-center]:not-data-expanded:opacity-0",
                // Define offset-y variable
                "data-[position*=top]:[--toast-calc-offset-y:calc(var(--toast-offset-y)+var(--toast-index)*var(--toast-gap)+var(--toast-swipe-movement-y))]",
                "data-[position*=bottom]:[--toast-calc-offset-y:calc(var(--toast-offset-y)*-1+var(--toast-index)*var(--toast-gap)*-1+var(--toast-swipe-movement-y))]",
                // Default state transform
                "data-[position*=top]:transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)+(var(--toast-index)*var(--toast-peek))+(var(--toast-shrink)*var(--toast-calc-height))))_scale(var(--toast-scale))]",
                "data-[position*=bottom]:transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--toast-peek))-(var(--toast-shrink)*var(--toast-calc-height))))_scale(var(--toast-scale))]",
                // Limited state
                "data-limited:opacity-0",
                // Expanded state
                "data-expanded:h-(--toast-height)",
                "data-position:data-expanded:transform-[translateX(var(--toast-swipe-movement-x))_translateY(var(--toast-calc-offset-y))]",
                // Starting and ending animations
                "data-[position*=top]:data-starting-style:transform-[translateY(calc(-100%-var(--toast-inset)))]",
                "data-[position=top-center]:data-ending-style:not-data-limited:not-data-swipe-direction:transform-[translateY(calc(var(--toast-swipe-movement-y)-100%-var(--toast-inset)))]",
                "data-[position*=bottom]:data-starting-style:transform-[translateY(calc(100%+var(--toast-inset)))]",
                "data-[position*=top]:data-[position*=right]:data-starting-style:transform-[translateX(calc(100%+var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]",
                "data-ending-style:opacity-0",
                // Ending animations (direction-aware)
                "data-ending-style:not-data-limited:not-data-swipe-direction:transform-[translateY(calc(100%+var(--toast-inset)))]",
                "data-[position*=top]:data-[position*=right]:data-ending-style:not-data-limited:not-data-swipe-direction:transform-[translateX(calc(100%+var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]",
                "data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(var(--toast-swipe-movement-x)-100%-var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]",
                "data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+100%+var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]",
                "data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-100%-var(--toast-inset)))]",
                "data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+100%+var(--toast-inset)))]",
                // Ending animations (expanded)
                "data-expanded:data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(var(--toast-swipe-movement-x)-100%-var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]",
                "data-expanded:data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+100%+var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]",
                "data-expanded:data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-100%-var(--toast-inset)))]",
                "data-expanded:data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+100%+var(--toast-inset)))]",
                // Closed/limited toasts stay mounted briefly for animation; they must
                // never sit as invisible hit targets above a fresh interactive toast.
                "data-ending-style:pointer-events-none data-limited:pointer-events-none",
              )}
              data-position={position}
              key={toast.id}
              style={
                {
                  "--toast-index": visibleIndex,
                  "--toast-offset-y": `${offsetY}px`,
                } as CSSProperties
              }
              swipeDirection={
                position.includes("center")
                  ? [isTop ? "up" : "down"]
                  : position.includes("left")
                    ? ["left", isTop ? "up" : "down"]
                    : ["right", isTop ? "up" : "down"]
              }
              toast={toast}
            >
              <ToastSurface hideCollapsedContent={hideCollapsedContent} toast={toast} />
            </Toast.Root>
          );
        })}
      </Toast.Viewport>
    </Toast.Portal>
  );
}
function AnchoredToastProvider({
  children,
  timeout = DEFAULT_TOAST_TIMEOUT_MS,
  ...props
}: Toast.Provider.Props) {
  return (
    <Toast.Provider timeout={timeout} toastManager={anchoredToastManager} {...props}>
      {children}
      <AnchoredToasts />
    </Toast.Provider>
  );
}
// Anchored toasts are short confirmations next to the control that caused them, so they use the
// tooltip chrome rather than the notification card.
function AnchoredToasts() {
  const { toasts } = Toast.useToastManager();
  return (
    <Toast.Portal data-slot="toast-portal-anchored">
      <Toast.Viewport className="outline-none" data-slot="toast-viewport-anchored">
        {toasts.map((toast) => {
          const positionerProps = toast.positionerProps;
          if (!positionerProps?.anchor) {
            return null;
          }
          return (
            <Toast.Positioner
              className="z-50 max-w-[min(--spacing(64),var(--available-width))]"
              data-slot="toast-positioner"
              key={toast.id}
              sideOffset={positionerProps.sideOffset ?? 4}
              toast={toast}
            >
              <Toast.Root
                className="relative rounded-lg border bg-popover text-balance text-popover-foreground text-ui leading-snug shadow-md/5 transition-[scale,opacity] [-webkit-app-region:no-drag] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]"
                data-slot="toast-popup"
                toast={toast}
              >
                <Toast.Content className="pointer-events-auto px-2 py-1">
                  <Toast.Title data-slot="toast-title" />
                </Toast.Content>
              </Toast.Root>
            </Toast.Positioner>
          );
        })}
      </Toast.Viewport>
    </Toast.Portal>
  );
}
export {
  ToastProvider,
  type ToastAction,
  type ToastPosition,
  toastManager,
  AnchoredToastProvider,
  anchoredToastManager,
};
