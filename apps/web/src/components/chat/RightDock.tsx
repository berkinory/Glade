import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { cn } from "~/lib/utils";
import { useIsMobile } from "~/hooks/useMediaQuery";
import {
  type DockPaneRuntimeMode,
  EMPTY_PANE_ID_SET,
  reconcileKeepMountedPaneIds,
} from "~/lib/dockPaneActivation";
import { PanelCollapseIcon, PanelExpandIcon, PanelRightCloseIcon, PlusIcon } from "~/lib/icons";
import type {
  RightDockPane,
  RightDockPaneKind,
  RightDockThreadState,
} from "~/rightDockStore.logic";
import { resolveActivePane } from "~/rightDockStore.logic";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Menu, MenuItem, MenuTrigger } from "../ui/menu";
import {
  Sidebar,
  SIDEBAR_DEFAULT_WIDTH_REDUCTION_PX,
  SIDEBAR_OFFCANVAS_MOTION_CLASS,
  SIDEBAR_OFFCANVAS_MOTION_SUPPRESSED_CLASS,
  SidebarProvider,
  SidebarRail,
} from "../ui/sidebar";
import { CHAT_BACKGROUND_CLASS_NAME } from "./composerPickerStyles";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";
import {
  CHAT_SURFACE_HEADER_ROW_CLASS_NAME,
  CHAT_SURFACE_CONTROL_ACTIVE_CLASS_NAME,
  CHAT_HEADER_ICON_CONTROL_CLASS_NAME,
  SurfaceChipIcon,
  SurfaceTabChip,
} from "./chatHeaderControls";
import {
  getRightDockPaneMeta,
  resolveRightDockPaneIcon,
  resolveRightDockPaneLabel,
} from "./rightDockPaneMeta";
import { useDesktopTopBarWindowControlsGutterClassName } from "~/hooks/useDesktopTopBarGutter";

interface RightDockProps {
  state: RightDockThreadState;
  initialWidth?: "half" | "fixed";
  minWidth: number;
  maxWidth: number;
  defaultWidth: string;
  shouldAcceptWidth: (context: {
    currentWidth: number;
    nextWidth: number;
    wrapper: HTMLElement;
  }) => boolean;
  paneLabelOverrides?: Record<string, string | undefined>;

  paneIconOverrides?: Record<string, ReactNode | undefined>;
  addMenuKinds: readonly RightDockPaneKind[];
  primaryKinds?: readonly RightDockPaneKind[];

  onSelectPane?: ((paneId: string) => void) | undefined;
  onClosePane: (paneId: string) => void;
  onCollapse: () => void;
  onOpenChange: (open: boolean) => void;
  onAddPane: (kind: RightDockPaneKind) => void;
  motionKey?: string;
  activePaneRuntimeMode?: DockPaneRuntimeMode;
  browserRuntimeMode?: DockPaneRuntimeMode;
  renderPane: (
    pane: RightDockPane,
    context: { runtimeMode: DockPaneRuntimeMode; isActive: boolean; isVisible: boolean },
  ) => ReactNode;
}

function RightDockTab(props: {
  pane: RightDockPane;
  label: string;
  icon?: ReactNode;
  active: boolean;
  onSelect?: (() => void) | undefined;
  onClose: () => void;
}) {
  return (
    <SurfaceTabChip
      active={props.active}
      title={props.label}
      label={props.label}
      labelClassName="max-w-[10rem]"
      icon={props.icon ?? resolveRightDockPaneIcon(props.pane)}
      closeLabel={`Close ${props.label}`}
      onSelect={props.onSelect}
      onClose={props.onClose}
    />
  );
}

// Persist which keep-mounted panes (e.g. terminals) have been activated so they stay in the DOM
// while another tab is selected, pruned to live panes so closed panes drop out and the set never
// leaks across thread switches. The set is The rendered set is derived synchronously so a kept pane
// never unmounts for a frame. A layout effect commits that set for the next render without mutating
// a ref during render (which is unsafe when React replays or abandons work).
function useKeepMountedPaneIds(
  panes: readonly RightDockPane[],
  activePane: RightDockPane | null,
): ReadonlySet<string> {
  const [committedPaneIds, setCommittedPaneIds] = useState<ReadonlySet<string>>(EMPTY_PANE_ID_SET);
  const activePaneId = activePane?.id ?? null;
  const activePaneKind = activePane?.kind ?? null;
  const renderedPaneIds = reconcileKeepMountedPaneIds({
    previous: committedPaneIds,
    panes,
    activePaneId,
    activePaneKind,
  });

  useLayoutEffect(() => {
    setCommittedPaneIds((current) => {
      const next = reconcileKeepMountedPaneIds({
        previous: current,
        panes,
        activePaneId,
        activePaneKind,
      });
      if (next.size === current.size && [...next].every((paneId) => current.has(paneId))) {
        return current;
      }
      return next;
    });
  }, [activePaneId, activePaneKind, panes]);

  return renderedPaneIds;
}

export function RightDock(props: RightDockProps) {
  const { onCollapse } = props;
  const paneCount = props.state.panes.length;
  const activePane = resolveActivePane(props.state);
  const onSelectPane = props.onSelectPane;
  const activePaneRuntimeMode = props.activePaneRuntimeMode ?? "live";
  const browserRuntimeMode = props.browserRuntimeMode ?? "live";

  const desktopTopBarWindowControlsGutterClassName =
    useDesktopTopBarWindowControlsGutterClassName();

  const keepMountedPaneIds = useKeepMountedPaneIds(props.state.panes, activePane);

  const contentRef = useRef<HTMLDivElement | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const expansionKey = props.motionKey ?? "dock";
  const isMobile = useIsMobile();
  const maximized = !isMobile && props.state.open && expandedKey === expansionKey;
  const [expandedWidth, setExpandedWidth] = useState(0);
  useLayoutEffect(() => {
    if (maximized && paneCount === 0) {
      setExpandedKey(null);
      onCollapse();
    }
  }, [maximized, paneCount, onCollapse]);
  useLayoutEffect(() => {
    if (!maximized) return;
    const wrapper = contentRef.current?.closest<HTMLElement>("[data-slot='sidebar-wrapper']");
    const shell = wrapper?.parentElement;
    if (!shell || !wrapper) return;
    const update = () => setExpandedWidth(shell.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(shell);

    const siblings = Array.from(shell.children).filter(
      (element): element is HTMLElement => element instanceof HTMLElement && element !== wrapper,
    );
    const previous = siblings.map((element) => ({
      inert: element.inert,
      visibility: element.style.visibility,
    }));
    siblings.forEach((element) => {
      element.inert = true;

      element.style.visibility = "hidden";
    });
    return () => {
      observer.disconnect();
      siblings.forEach((element, index) => {
        element.inert = previous[index]?.inert ?? false;
        element.style.visibility = previous[index]?.visibility ?? "";
      });
    };
  }, [maximized]);
  useEffect(() => {
    if (!props.state.open) setExpandedKey(null);
  }, [props.state.open]);
  const minWidth = props.minWidth;
  const [resizeMaxWidth, setResizeMaxWidth] = useState(minWidth * 1.5);
  const widthInitializedRef = useRef(false);
  useEffect(() => {
    if (props.initialWidth === "fixed" || !props.state.open || widthInitializedRef.current) {
      return;
    }
    const wrapper = contentRef.current?.closest<HTMLElement>("[data-slot='sidebar-wrapper']");
    const shell = wrapper?.parentElement;
    if (!wrapper || !shell) {
      return;
    }
    const openWidth = Math.round(
      (shell.getBoundingClientRect().width + SIDEBAR_DEFAULT_WIDTH_REDUCTION_PX) / 2,
    );
    if (openWidth > 0) {
      const defaultWidth = Math.max(minWidth, openWidth);
      setResizeMaxWidth(Math.round(defaultWidth * 1.5));
      wrapper.style.setProperty("--sidebar-width", `${defaultWidth}px`);
      widthInitializedRef.current = true;
    }
  }, [props.state.open, props.initialWidth, minWidth]);
  const renderedPanes = props.state.panes.filter(
    (pane) => pane.id === activePane?.id || keepMountedPaneIds.has(pane.id),
  );

  const [motionState, setMotionState] = useState<{
    key: RightDockProps["motionKey"];
    allow: boolean;
  }>(() => ({ key: props.motionKey, allow: !props.state.open }));
  const shouldSuppressChromeMotion = !(motionState.key === props.motionKey && motionState.allow);

  useEffect(() => {
    if (!shouldSuppressChromeMotion) {
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      setMotionState({ key: props.motionKey, allow: true });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [props.motionKey, shouldSuppressChromeMotion]);

  const chromeMotionClass = shouldSuppressChromeMotion
    ? SIDEBAR_OFFCANVAS_MOTION_SUPPRESSED_CLASS
    : SIDEBAR_OFFCANVAS_MOTION_CLASS;

  return (
    <SidebarProvider
      defaultOpen={false}
      open={props.state.open}
      onOpenChange={props.onOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ "--sidebar-width": props.defaultWidth } as CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className={cn(
          "border-l border-[var(--app-surface-divider)] text-foreground",
          chromeMotionClass,
        )}
        style={maximized ? { width: expandedWidth || undefined, zIndex: 30 } : undefined}
        data-dock-maximized={maximized ? "true" : undefined}
        innerClassName={CHAT_BACKGROUND_CLASS_NAME}
        rail={!maximized ? <SidebarRail /> : null}
        gapClassName={chromeMotionClass}
        transparentSurface
        resizable={{
          minWidth: props.minWidth,
          maxWidth: Math.min(props.maxWidth, resizeMaxWidth),
          shouldAcceptWidth: props.shouldAcceptWidth,
        }}
      >
        <div
          ref={contentRef}
          data-right-dock-content
          className="flex h-full min-h-0 w-full flex-col"
        >
          <div
            className={cn(
              CHAT_SURFACE_HEADER_ROW_CLASS_NAME,
              "drag-region gap-1 pl-1.5 pr-3 sm:pr-5",
              desktopTopBarWindowControlsGutterClassName,
            )}
          >
            {props.primaryKinds ? (
              <nav aria-label="Right sidebar panels" className="flex shrink-0 items-center gap-1">
                {props.primaryKinds.map((kind) => {
                  const { Icon, label } = getRightDockPaneMeta(kind);
                  return (
                    <IconButton
                      key={kind}
                      variant="chrome"
                      size="icon-xs"
                      label={label}
                      tooltip={label}
                      tooltipSide="bottom"
                      title={label}
                      aria-pressed={activePane?.kind === kind}
                      className={cn(
                        CHAT_HEADER_ICON_CONTROL_CLASS_NAME,
                        activePane?.kind === kind && CHAT_SURFACE_CONTROL_ACTIVE_CLASS_NAME,
                      )}
                      onClick={() => props.onAddPane(kind)}
                    >
                      <SurfaceChipIcon icon={Icon} />
                    </IconButton>
                  );
                })}
              </nav>
            ) : null}
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {props.state.panes
                .filter((pane) => !props.primaryKinds?.includes(pane.kind))
                .map((pane) => (
                  <RightDockTab
                    key={pane.id}
                    pane={pane}
                    label={resolveRightDockPaneLabel(pane, props.paneLabelOverrides)}
                    icon={props.paneIconOverrides?.[pane.id]}
                    active={pane.id === props.state.activePaneId}
                    onSelect={onSelectPane ? () => onSelectPane(pane.id) : undefined}
                    onClose={() => props.onClosePane(pane.id)}
                  />
                ))}
            </div>
            {!props.primaryKinds &&
            props.state.panes.length > 0 &&
            props.addMenuKinds.length > 0 ? (
              <Menu modal={false}>
                <MenuTrigger
                  render={
                    <Button
                      variant="chrome"
                      size="icon-xs"
                      aria-label="Add panel"
                      title="Add panel"
                      className={CHAT_HEADER_ICON_CONTROL_CLASS_NAME}
                    />
                  }
                >
                  <PlusIcon className="size-3.5" />
                </MenuTrigger>
                <ComposerPickerMenuPopup align="end" side="bottom" className="w-44 min-w-44">
                  {props.addMenuKinds.map((kind) => {
                    const { Icon, label } = getRightDockPaneMeta(kind);
                    return (
                      <MenuItem key={kind} onClick={() => props.onAddPane(kind)}>
                        <Icon className="size-3.5 shrink-0" />
                        <span>{label}</span>
                      </MenuItem>
                    );
                  })}
                </ComposerPickerMenuPopup>
              </Menu>
            ) : null}
            {!isMobile && (maximized || activePane !== null) ? (
              <IconButton
                variant="chrome"
                size="icon-xs"
                label={maximized ? "Restore panel" : "Maximize panel"}
                tooltip={maximized ? "Restore panel" : "Maximize panel"}
                aria-pressed={maximized}
                className={CHAT_HEADER_ICON_CONTROL_CLASS_NAME}
                onClick={() => setExpandedKey(maximized ? null : expansionKey)}
              >
                {maximized ? <PanelCollapseIcon /> : <PanelExpandIcon />}
              </IconButton>
            ) : null}
            <IconButton
              variant="chrome"
              size="icon-xs"
              label="Collapse panel"
              tooltip="Collapse panel"
              tooltipSide="bottom"
              className={CHAT_HEADER_ICON_CONTROL_CLASS_NAME}
              onClick={props.onCollapse}
            >
              <PanelRightCloseIcon />
            </IconButton>
          </div>
          <div className="relative min-h-0 flex-1">
            {renderedPanes.map((pane) => {
              const isActive = pane.id === activePane?.id;
              const isVisible = isActive && props.state.open;

              const runtimeMode: DockPaneRuntimeMode =
                pane.kind === "browser"
                  ? browserRuntimeMode
                  : isActive
                    ? activePaneRuntimeMode
                    : "live";
              return (
                <div
                  key={pane.id}
                  className={cn(
                    "absolute inset-0 flex min-h-0 w-full",
                    isActive ? undefined : "invisible pointer-events-none",
                  )}
                  aria-hidden={isVisible ? undefined : true}
                  inert={isVisible ? undefined : true}
                  data-native-browser-surface={
                    pane.kind === "browser" && isActive && runtimeMode === "live"
                      ? "true"
                      : undefined
                  }
                >
                  {props.renderPane(pane, { runtimeMode, isActive, isVisible })}
                </div>
              );
            })}
          </div>
        </div>
      </Sidebar>
    </SidebarProvider>
  );
}
