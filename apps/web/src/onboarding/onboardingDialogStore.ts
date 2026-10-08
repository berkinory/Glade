import { create } from "zustand";

type OnboardingOpenReason = "first-run" | "replay";

interface OnboardingDialogStore {
  isOpen: boolean;

  startupGateSettled: boolean;

  // Stays true through the close animation so the next startup surface waits for it.
  presented: boolean;

  openReason: OnboardingOpenReason | null;

  engaged: boolean;
  open: (reason: OnboardingOpenReason) => void;

  openDialog: () => void;
  close: () => void;
  markEngaged: () => void;
  markStartupGateSettled: () => void;
  setPresented: (presented: boolean) => void;
}

export const useOnboardingDialogStore = create<OnboardingDialogStore>((set) => ({
  isOpen: false,
  startupGateSettled: false,
  presented: false,
  openReason: null,
  engaged: false,
  open: (reason) => set({ isOpen: true, openReason: reason, engaged: false }),
  openDialog: () => set({ isOpen: true, openReason: "replay", engaged: false }),
  close: () => set({ isOpen: false, openReason: null, engaged: false }),
  markEngaged: () => set({ engaged: true }),
  markStartupGateSettled: () => set({ startupGateSettled: true }),
  setPresented: (presented) => set({ presented }),
}));

// Startup surfaces show one at a time: onboarding first, then release notes.
// Lazy loading and the close animation both still count as onboarding.
export const selectOnboardingHoldsStartup = (state: OnboardingDialogStore): boolean =>
  !state.startupGateSettled || state.isOpen || state.presented;
