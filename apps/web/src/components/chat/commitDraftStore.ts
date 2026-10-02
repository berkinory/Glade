import type { CommitScope } from "./sourceControlCommitScope";
import { create } from "zustand";

export const useCommitDrafts = create<{
  messages: Record<string, string>;
  scopes: Record<string, CommitScope | undefined>;
  setSuggestion: (cwd: string, message: string, scope: CommitScope) => void;
  set: (cwd: string, message: string) => void;
}>((set) => ({
  messages: {},
  scopes: {},
  setSuggestion: (cwd, message, scope) =>
    set((state) => ({
      messages: { ...state.messages, [cwd]: message },
      scopes: { ...state.scopes, [cwd]: scope },
    })),
  set: (cwd, message) =>
    set((state) => ({
      messages: { ...state.messages, [cwd]: message },
      scopes: { ...state.scopes, [cwd]: undefined },
    })),
}));
