import { create } from "zustand";

export const useCommitDrafts = create<{
  messages: Record<string, string>;
  set: (cwd: string, message: string) => void;
}>((set) => ({
  messages: {},
  set: (cwd, message) => set((state) => ({ messages: { ...state.messages, [cwd]: message } })),
}));
