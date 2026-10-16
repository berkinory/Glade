import { createContext, type ReactNode } from "react";

export const WorkspaceHeaderContext = createContext<{
  host: HTMLDivElement | null;
  /** Layer behind both the header host and the tab content, for full-bleed decoration. */
  backdrop: HTMLDivElement | null;
  tabs: ReactNode;
} | null>(null);
