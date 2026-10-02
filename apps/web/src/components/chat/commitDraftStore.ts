import type { CommitScope } from "./sourceControlCommitScope";
import { create } from "zustand";

export const useCommitDrafts = create<{
  messages: Record<string, string>;
  generationErrors: Record<string, string | undefined>;
  setGenerationError: (cwd: string, error: string | undefined) => void;
  scopes: Record<string, CommitScope | undefined>;
  setSuggestion: (cwd: string, message: string, scope: CommitScope) => void;
  set: (cwd: string, message: string) => void;
}>((set) => ({
  messages: {},
  generationErrors: {},
  setGenerationError: (cwd, error) =>
    set((state) => ({ generationErrors: { ...state.generationErrors, [cwd]: error } })),
  scopes: {},
  setSuggestion: (cwd, message, scope) =>
    set((state) => ({
      messages: { ...state.messages, [cwd]: message },
      scopes: { ...state.scopes, [cwd]: scope },
      generationErrors: { ...state.generationErrors, [cwd]: undefined },
    })),
  set: (cwd, message) =>
    set((state) => ({
      messages: { ...state.messages, [cwd]: message },
      scopes: { ...state.scopes, [cwd]: undefined },
    })),
}));
