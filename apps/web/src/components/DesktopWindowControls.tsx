import { ArrowExpandIcon, CollapseIcon, MinusIcon, XIcon } from "~/lib/icons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DesktopWindowState } from "@glade/contracts/ipc/ipc";
import { useDesktopCustomTitleBarActive } from "~/hooks/useDesktopCustomTitleBar";
import { isElectron } from "~/env";
import { toastManager } from "./ui/toast";
import { cn, getNavigatorPlatform, isWindowsPlatform } from "~/lib/utils";
const DEFAULT_WINDOW_STATE: DesktopWindowState = {
  isMaximized: false,
  isFullscreen: false,
};
const GLYPH_MINIMIZE = "\uE921";
const GLYPH_MAXIMIZE = "\uE922";
const GLYPH_RESTORE = "\uE923";
const GLYPH_CLOSE = "\uE8BB";
const CAPTION_BUTTON_CLASS =
  "flex h-full w-[46px] shrink-0 items-center justify-center text-foreground/90 outline-none transition-colors duration-80 select-none hover:bg-foreground/[0.09] active:bg-foreground/[0.05] [-webkit-app-region:no-drag]";
const CLOSE_BUTTON_CLASS = "hover:bg-[#c42b1c] hover:text-white active:bg-[#b9281b]";
function CaptionGlyph({ glyph }: { glyph: string }) {
  return (
    <span
      aria-hidden="true"
      className="text-[10px] leading-none"
      style={{
        fontFamily: '"Segoe Fluent Icons", "Segoe MDL2 Assets"',
      }}
    >
      {glyph}
    </span>
  );
}
function CaptionSvg({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" className="flex size-3.5 items-center justify-center">
      {children}
    </span>
  );
}
export function DesktopWindowControls({ className }: { className?: string }) {
  const runControl = useRef<((title: string, action: () => Promise<unknown>) => void) | null>(null);
  const [windowState, setWindowState] = useState<DesktopWindowState>(DEFAULT_WINDOW_STATE);
  const customTitleBarActive = useDesktopCustomTitleBarActive();
  const platform = getNavigatorPlatform();
  const useWindowsGlyphs = isWindowsPlatform(platform);
  const controls = typeof window === "undefined" ? undefined : window.desktopBridge?.windowControls;
  useEffect(() => {
    if (!controls) return;
    let cancelled = false;
    let stateRevision = 0;
    const pending = new Set<string>();
    const reportError = (title: string, error: unknown) => {
      if (cancelled) return;
      toastManager.add({
        type: "error",
        title,
        description: error instanceof Error ? error.message : "Please try again.",
      });
    };
    runControl.current = (title, action) => {
      if (pending.has(title)) return;
      pending.add(title);
      void Promise.resolve()
        .then(() => {
          if (!cancelled) return action();
        })
        .catch((error: unknown) => reportError(title, error))
        .finally(() => pending.delete(title));
    };
    runControl.current("Could not read window state", async () => {
      const revision = stateRevision;
      const state = await controls.getState();
      if (!cancelled && revision === stateRevision) setWindowState(state);
    });
    const unsubscribe = controls.onState((state) => {
      stateRevision += 1;
      if (!cancelled) setWindowState(state);
    });
    return () => {
      cancelled = true;
      runControl.current = null;
      unsubscribe();
    };
  }, [controls]);
  if (!isElectron || !customTitleBarActive || !controls) {
    return null;
  }
  const { isMaximized } = windowState;
  return (
    <div className={cn("flex h-[46px] items-stretch [-webkit-app-region:no-drag]", className)}>
      <button
        type="button"
        aria-label="Minimize"
        title="Minimize"
        className={CAPTION_BUTTON_CLASS}
        onClick={() => {
          runControl.current?.("Could not minimize window", () => controls.minimize());
        }}
      >
        {useWindowsGlyphs ? (
          <CaptionGlyph glyph={GLYPH_MINIMIZE} />
        ) : (
          <CaptionSvg>
            <MinusIcon className="size-3.5" />
          </CaptionSvg>
        )}
      </button>
      <button
        type="button"
        aria-label={isMaximized ? "Restore" : "Maximize"}
        title={isMaximized ? "Restore" : "Maximize"}
        className={CAPTION_BUTTON_CLASS}
        onClick={() => {
          runControl.current?.("Could not resize window", () => controls.toggleMaximize());
        }}
      >
        {useWindowsGlyphs ? (
          <CaptionGlyph glyph={isMaximized ? GLYPH_RESTORE : GLYPH_MAXIMIZE} />
        ) : (
          <CaptionSvg>
            {isMaximized ? (
              <CollapseIcon className="size-3.5" />
            ) : (
              <ArrowExpandIcon className="size-3.5" />
            )}
          </CaptionSvg>
        )}
      </button>
      <button
        type="button"
        aria-label="Close"
        title="Close"
        className={cn(CAPTION_BUTTON_CLASS, CLOSE_BUTTON_CLASS)}
        onClick={() => {
          runControl.current?.("Could not close window", () => controls.close());
        }}
      >
        {useWindowsGlyphs ? (
          <CaptionGlyph glyph={GLYPH_CLOSE} />
        ) : (
          <CaptionSvg>
            <XIcon className="size-3.5" />
          </CaptionSvg>
        )}
      </button>
    </div>
  );
}
