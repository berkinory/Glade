import type { DesktopAgentCursorStyle } from "@glade/contracts";
import { useEffect } from "react";

import {
  DEFAULT_AGENT_CURSOR_COLOR_MODE,
  resolveAgentCursorColors,
  type AppSettings,
} from "~/appSettings";

// Send one cursor-style value to the desktop main process. A rejected send is swallowed: main
// already holds the last durable value, and a background mirror failing must not surface as an
// error in the settings UI.
function pushAgentCursorStyleToDesktop(style: DesktopAgentCursorStyle | null): void {
  if (typeof window === "undefined") return;
  const bridge = window.desktopBridge?.computer;
  if (!bridge?.setCursorStyle) return;
  void bridge.setCursorStyle(style).catch(() => undefined);
}

export function useAgentCursorDesktopSync(settings: AppSettings): void {
  const mode = settings.agentCursorColorMode ?? DEFAULT_AGENT_CURSOR_COLOR_MODE;
  const fill = settings.agentCursorFillColor ?? "";
  const rim = settings.agentCursorRimColor ?? "";
  useEffect(() => {
    pushAgentCursorStyleToDesktop(
      resolveAgentCursorColors({
        agentCursorColorMode: mode,
        agentCursorFillColor: fill,
        agentCursorRimColor: rim,
      }),
    );
  }, [mode, fill, rim]);
}
