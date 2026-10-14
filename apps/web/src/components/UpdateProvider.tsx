import { createContext, useContext, type ReactNode } from "react";

import { useUpdateEverything, type UpdateControls } from "./useUpdateEverything";

const UpdateContext = createContext<UpdateControls | null>(null);

export function UpdateProvider({ children }: { children: ReactNode }) {
  const value = useUpdateEverything();
  return <UpdateContext value={value}>{children}</UpdateContext>;
}

export function useUpdates(): UpdateControls {
  const context = useContext(UpdateContext);
  if (!context) throw new Error("useUpdates requires UpdateProvider");
  return context;
}
