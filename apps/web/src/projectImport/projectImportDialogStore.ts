import type { ProjectImportProvider } from "@glade/contracts/workspace/projectImport";
import { create } from "zustand";

export const useProjectImportDialogStore = create<{
  isOpen: boolean;

  initialProviders: readonly ProjectImportProvider[] | null;
  openDialog: (providers?: readonly ProjectImportProvider[]) => void;
  closeDialog: () => void;
}>((set) => ({
  isOpen: false,
  initialProviders: null,
  openDialog: (providers) => set({ isOpen: true, initialProviders: providers ?? null }),
  closeDialog: () => set({ isOpen: false }),
}));
