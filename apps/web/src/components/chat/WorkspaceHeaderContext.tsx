import { createContext, type ReactNode } from "react";

export const WorkspaceHeaderContext = createContext<{
  host: HTMLDivElement | null;
  tabs: ReactNode;
} | null>(null);
