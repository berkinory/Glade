import type { BrowserPanelProps } from "./browserPanelSupport";
import { useBrowserActionsController } from "./useBrowserActionsController";
import { useBrowserRendererController } from "./useBrowserRendererController";
import { useBrowserStateController } from "./useBrowserStateController";
import { useBrowserViewportController } from "./useBrowserViewportController";
export function useBrowserController(props: BrowserPanelProps) {
  const state = useBrowserStateController(props);
  useBrowserRendererController({ state, props });
  useBrowserViewportController({ state, props });
  const actions = useBrowserActionsController({ state, props });
  return { props, state, actions };
}
export type BrowserController = ReturnType<typeof useBrowserController>;
