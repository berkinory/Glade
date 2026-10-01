import { createContext, useContext } from "react";
import type { BrowserPanelProps } from "./browserPanelSupport";

export const BrowserPanelContext = createContext<BrowserPanelProps | null>(null);

export function useBrowserPanelScope(): BrowserPanelProps {
  const scope = useContext(BrowserPanelContext);
  if (!scope) throw new Error("Browser panel scope is missing.");
  return scope;
}
