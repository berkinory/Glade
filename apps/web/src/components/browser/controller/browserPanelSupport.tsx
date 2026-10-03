import { Spinner } from "~/components/ui/spinner";
import { type ThreadId } from "@glade/contracts/core/baseSchemas";
import { type ServerLocalServerProcess } from "@glade/contracts/server/server";
import { localServerPrimaryLabel } from "~/lib/localServers";
import { type BrowserAnnotationsController } from "~/components/browser/useBrowserAnnotations";
import {
  createBrowserPanelHideScheduler,
  createBrowserPanelRendererHandoff,
  hasObscuringHitStackElementAboveSurface,
} from "~/components/BrowserPanel.logic";
import { type BrowserPanelMode } from "~/components/browser/BrowserPanelShell";
import { LocalServerIdentity } from "~/components/LocalServerIdentity";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import type { BrowserAnnotationDraft } from "~/lib/browserAnnotations";
import { CentralIcon } from "~/lib/central-icons";
import type { DockPaneRuntimeMode } from "~/lib/dockPaneActivation";
import { CircleAlertIcon, GlobeIcon, RefreshCwIcon, type LucideIcon } from "~/lib/icons";
import { NATIVE_SURFACE_MENU_OVERLAY_SELECTOR } from "~/lib/nativeSurfaceOcclusion";
export interface BrowserPanelProps {
  hideTabs?: boolean;
  isVisible?: boolean;
  mode: BrowserPanelMode;
  threadId: ThreadId;
  onClosePanel: () => void;
  runtimeMode?: DockPaneRuntimeMode;
  onRequestLive?: () => void;
}
export const BROWSER_BOUNDS_SYNC_BURST_FRAMES = 30;
export const BROWSER_BOUNDS_SYNC_STABLE_FRAME_TARGET = 2;
export const BROWSER_WEBVIEW_PARTITION = "persist:glade-browser";
export const BROWSER_PERF_SAMPLE_INTERVAL_MS = 5_000;
export const GLADE_BROWSER_LABEL = "Glade browser";
export const browserPanelHideScheduler = createBrowserPanelHideScheduler();
export const browserPanelRendererHandoff = createBrowserPanelRendererHandoff();
export const BROWSER_ACTION_MENU_PANEL_CLASS_NAME = "w-52 min-w-52";
export const BROWSER_ACTION_MENU_ITEM_CLASS_NAME =
  "text-[var(--color-text-foreground)] data-highlighted:text-[var(--color-text-foreground)]";
const BROWSER_ACTION_MENU_ICON_CLASS_NAME =
  "inline-flex size-3.5 shrink-0 items-center justify-center text-[var(--color-text-foreground-secondary)] [&>svg]:size-3.5 [&>[data-slot=central-icon]]:size-3.5";
export const EMPTY_BROWSER_ANNOTATIONS: readonly BrowserAnnotationDraft[] = [];
const NATIVE_BROWSER_OBSCURING_OVERLAY_SELECTOR = [
  NATIVE_SURFACE_MENU_OVERLAY_SELECTOR,
  "[data-slot='dialog-backdrop']",
  "[data-slot='dialog-popup']",
  "[data-slot='dialog-viewport']",
  "[data-slot='alert-dialog-backdrop']",
  "[data-slot='alert-dialog-popup']",
  "[data-slot='alert-dialog-viewport']",
  "[data-slot='command-dialog-backdrop']",
  "[data-slot='command-dialog-popup']",
  "[data-slot='command-dialog-viewport']",
  "[data-slot='toast-popup']",
  "[role='dialog'][aria-modal='true']",
].join(", ");
export function BrowserActionMenuIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className={BROWSER_ACTION_MENU_ICON_CLASS_NAME}>
      <Icon aria-hidden="true" />
    </span>
  );
}
export function BrowserAnnotationButton(props: {
  controller: BrowserAnnotationsController;
  disabled: boolean;
}) {
  const label = props.controller.active ? "Cancel annotation" : "Annotate page";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant={props.controller.active ? "default" : "ghost"}
            size="icon-sm"
            className="size-7 [&_[data-slot=central-icon]]:!opacity-100"
            disabled={props.disabled}
            aria-label={label}
            aria-pressed={props.controller.active}
            aria-busy={props.controller.starting || undefined}
            data-pressed={props.controller.active ? "" : undefined}
            title={label}
            onClick={props.controller.toggle}
          />
        }
      >
        <CentralIcon name="window-cursor" className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {props.controller.active
          ? "Cancel element selection (Esc)"
          : "Select an element to annotate"}
      </TooltipPopup>
    </Tooltip>
  );
}
const NATIVE_BROWSER_NON_OBSCURING_OVERLAY_SELECTOR = [
  "[data-panel-resize-overlay='true']",
  "[data-floating-browser-controls='true']",
  "[data-slot='sheet-backdrop']",
  "[data-slot='sheet-popup']",
  "[data-slot='toast-portal']",
  "[data-slot='toast-portal-anchored']",
  "[data-slot='toast-viewport']",
  "[data-slot='toast-viewport-anchored']",
  "[data-slot='toast-positioner']",
].join(", ");
export interface BrowserViewportPerfCounters {
  syncAttempts: number;
  syncSkips: number;
  syncSends: number;
  resizeSchedules: number;
  resizeScheduleSkips: number;
  burstStarts: number;
  burstExtensions: number;
  burstFrames: number;
  transitionSignals: number;
  ignoredTransitionSignals: number;
}
export interface BrowserWebviewElement extends HTMLElement {
  getWebContentsId?: () => number;
}
export const VIEWPORT_TRANSITION_PROPERTIES = new Set([
  "transform",
  "translate",
  "scale",
  "rotate",
  "width",
  "max-width",
  "min-width",
  "height",
  "max-height",
  "min-height",
  "left",
  "right",
  "top",
  "bottom",
  "inset",
  "inset-inline",
  "inset-inline-start",
  "inset-inline-end",
  "inset-block",
  "inset-block-start",
  "inset-block-end",
]);
export function formatBrowserActionError(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return "Couldn't complete that browser action.";
  }
  if (/ERR_ABORTED|\(-3\)/i.test(error.message)) {
    return null;
  }
  return "Couldn't complete that browser action.";
}
export function ignoreBrowserBoundsSyncError(): void {
  // Bounds sync is best-effort plumbing between the React shell and the native browser surface. Avoid
  // surfacing transient geometry-sync failures as user-facing browser errors because they do not
  // reflect page navigation health.
}
export function ignoreBrowserWebviewDetachError(): void {}
export function setBrowserWebviewOverlayOcclusion(
  webview: BrowserWebviewElement | null,
  occluded: boolean,
): void {
  if (!webview) {
    return;
  }

  webview.style.pointerEvents = occluded ? "none" : "auto";
}
function isVisibleOverlayElement(element: HTMLElement): boolean {
  const styles = window.getComputedStyle(element);
  if (styles.display === "none" || styles.visibility === "hidden" || styles.opacity === "0") {
    return false;
  }
  return element.getClientRects().length > 0;
}
function isNativeBrowserNonObscuringOverlayElement(element: HTMLElement): boolean {
  return (
    element.closest("[data-slot='toast-popup']") === null &&
    element.closest(NATIVE_BROWSER_NON_OBSCURING_OVERLAY_SELECTOR) !== null
  );
}
const NATIVE_BROWSER_OVERLAY_SAMPLE_POINTS = [
  [0.5, 0.5],
  [0.2, 0.2],
  [0.8, 0.2],
  [0.2, 0.8],
  [0.8, 0.8],
] as const;
function rectsIntersect(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
function candidateObscuresNativeBrowser(candidate: HTMLElement, element: HTMLElement): boolean {
  if (candidate === element || candidate.contains(element) || element.contains(candidate)) {
    return false;
  }
  if (!isVisibleOverlayElement(candidate)) {
    return false;
  }

  const elementRect = element.getBoundingClientRect();
  const candidateRects = candidate.getClientRects();
  for (const candidateRect of candidateRects) {
    if (rectsIntersect(elementRect, candidateRect)) {
      return true;
    }
  }

  return false;
}
function hasTopLayerDomObstruction(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  for (const [xRatio, yRatio] of NATIVE_BROWSER_OVERLAY_SAMPLE_POINTS) {
    const x = rect.left + rect.width * xRatio;
    const y = rect.top + rect.height * yRatio;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
      continue;
    }

    const hitElements = document.elementsFromPoint(x, y);
    if (
      hasObscuringHitStackElementAboveSurface(hitElements, {
        isSurfaceBoundary: (hitElement) =>
          hitElement === element ||
          (hitElement instanceof HTMLElement && element.contains(hitElement)),
        isNonObscuring: (hitElement) =>
          hitElement instanceof HTMLElement &&
          isNativeBrowserNonObscuringOverlayElement(hitElement),
        isVisible: (hitElement) =>
          hitElement instanceof HTMLElement && isVisibleOverlayElement(hitElement),
      })
    ) {
      return true;
    }
  }

  return false;
}
export function hasNativeBrowserObscuringOverlay(element: HTMLElement): boolean {
  const candidates = document.querySelectorAll<HTMLElement>(
    NATIVE_BROWSER_OBSCURING_OVERLAY_SELECTOR,
  );
  for (const candidate of candidates) {
    if (candidateObscuresNativeBrowser(candidate, element)) {
      return true;
    }
  }

  return hasTopLayerDomObstruction(element);
}
export function isNativeBrowserTransitionSignalTarget(
  target: EventTarget | null,
  viewportElement: HTMLElement,
): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (viewportElement.contains(target) || target.contains(viewportElement)) {
    return true;
  }

  return (
    target.closest(NATIVE_BROWSER_OBSCURING_OVERLAY_SELECTOR) !== null ||
    target.closest("[data-slot='sidebar-container']") !== null ||
    target.closest("[data-slot='sheet-popup']") !== null
  );
}
export function isBrowserPerfLoggingEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem("glade:browser-perf") === "1";
  } catch {
    return false;
  }
}
export function BrowserRuntimePreview(props: { title: string; detail: string }) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-background/35 p-6"
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-sm rounded-xl border border-border/60 bg-card/70 p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <Skeleton className="size-9 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/3 rounded-full" />
            <Skeleton className="h-2.5 w-full rounded-full" />
          </div>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-20 w-full rounded-lg" />
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-8 rounded-md" />
            <Skeleton className="h-8 rounded-md" />
            <Skeleton className="h-8 rounded-md" />
          </div>
        </div>
        <div className="mt-4 min-w-0 text-center">
          <p className="text-ui leading-snug font-medium text-foreground">Restoring browser</p>
          <p className="mt-1 truncate text-ui-sm text-muted-foreground" title={props.detail}>
            {props.title}
          </p>
        </div>
      </div>
    </div>
  );
}
export function BrowserRuntimeError(props: { message: string; onReload: () => void }) {
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-[#0d0d0d] px-6 text-center text-white"
      role="alert"
    >
      <div className="flex max-w-xs flex-col items-center">
        <CircleAlertIcon className="size-7 text-white/35" aria-hidden="true" />
        <p className="mt-3 text-ui-lg font-medium text-white/80">This page could not be loaded</p>
        <p className="mt-1 text-ui leading-snug text-white/45">{props.message}</p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={props.onReload}
        >
          Reload page
        </Button>
      </div>
    </div>
  );
}
function browserLocalServerUrl(server: ServerLocalServerProcess): string | null {
  const addressWithUrl = server.addresses.find((address) => address.url);
  if (addressWithUrl?.url) {
    return addressWithUrl.url;
  }

  const port = server.ports[0];
  if (!port) {
    return null;
  }
  return `http://localhost:${port}/`;
}
function BrowserLocalServerThumbnail({ server }: { server: ServerLocalServerProcess }) {
  const label = localServerPrimaryLabel(server);
  const port = server.ports[0];

  return (
    <span
      aria-hidden="true"
      className="flex h-12 w-[4.5rem] shrink-0 flex-col gap-1 overflow-hidden rounded-md border border-white/12 bg-[#f7f7f2] p-1.5 shadow-[0_4px_12px_rgba(0,0,0,0.28)]"
    >
      <span className="flex gap-[3px]">
        <span className="size-[3px] rounded-full bg-[#ff6b65]" />
        <span className="size-[3px] rounded-full bg-[#f4c047]" />
        <span className="size-[3px] rounded-full bg-[#45cf77]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <span className="truncate text-[7px] font-bold leading-none text-[#2a2a2a]">{label}</span>
        {port ? (
          <span className="truncate text-[6px] font-medium leading-none text-[#9a9a9a]">
            localhost:{port}
          </span>
        ) : null}
      </span>
    </span>
  );
}
export function BrowserLocalServersHome({
  activeTabId,
  loading,
  onNavigate,
  onRefresh,
  servers,
}: {
  activeTabId: string | null;
  loading: boolean;
  onNavigate: (url: string, tabId: string | null) => void;
  onRefresh: () => void;
  servers: readonly ServerLocalServerProcess[];
}) {
  const hasServers = servers.length > 0;

  return (
    <div className="absolute inset-0 z-20 flex flex-col overflow-hidden bg-[#0d0d0d] text-white">
      <div className="mx-auto flex h-full w-full max-w-[52rem] flex-col px-8 py-9">
        <div className="flex shrink-0 items-center justify-between">
          <p className="text-[15px] font-medium text-white/35">Local</p>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-8 text-white/35 hover:bg-white/[0.06] hover:text-white/70"
            disabled={loading}
            onClick={onRefresh}
            aria-label="Refresh local servers"
            title="Refresh local servers"
          >
            {loading ? (
              <Spinner variant="action" aria-hidden="true" className="size-4" />
            ) : (
              <RefreshCwIcon className="size-4" />
            )}
          </Button>
        </div>

        {!hasServers ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center text-center">
            {loading ? (
              <>
                <Spinner variant="action" className="mb-4 size-12  text-white/20" />
                <p className="text-base font-semibold text-white">Scanning local servers</p>
                <p className="mt-2 text-ui leading-snug text-white/35">Checking localhost ports</p>
              </>
            ) : (
              <>
                <GlobeIcon className="mb-4 size-16 stroke-[1.5] text-white/30" />
                <p className="text-base font-semibold text-white">No local servers</p>
                <p className="mt-2 text-ui leading-snug text-white/35">Try another browser URL</p>
              </>
            )}
          </div>
        ) : (
          <div className="mt-4 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-6">
            {servers.map((server) => {
              const url = browserLocalServerUrl(server);

              return (
                <button
                  key={server.id}
                  type="button"
                  disabled={!url}
                  onClick={() => {
                    if (url) {
                      onNavigate(url, activeTabId);
                    }
                  }}
                  className="group grid w-full shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5 rounded-xl border border-white/[0.07] px-3 py-2.5 text-left transition-colors hover:border-white/[0.14] hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <BrowserLocalServerThumbnail server={server} />
                  <LocalServerIdentity server={server} tone="browser" />
                  <span
                    className="mr-1 size-2 rounded-full bg-[#36d07b] shadow-[0_0_0_2.5px_rgba(54,208,123,0.16)]"
                    aria-hidden
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
