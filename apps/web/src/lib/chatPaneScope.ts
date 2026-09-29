export const SINGLE_CHAT_PANE_SCOPE_ID = "single";

export function splitViewPaneScopeId(splitViewId: string, paneId: string): string {
  return `${splitViewId}:${paneId}`;
}
