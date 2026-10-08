import { create } from "zustand";

import type { FeedbackThreadContext } from "./feedback";

interface FeedbackDialogStore {
  isOpen: boolean;
  context: FeedbackThreadContext | null;
  openDialog: (context?: FeedbackThreadContext) => void;
  setOpen: (open: boolean) => void;
}

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

// Handlers wired straight into `onClick` receive the click event at runtime
// whatever the declared type says. Copy only the known fields so the event (or
// anything else) never reaches the serialized submission.
function readFeedbackThreadContext(value: unknown): FeedbackThreadContext | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<keyof FeedbackThreadContext, unknown>;
  const {
    provider,
    model,
    projectKind,
    environmentMode,
    runtimeMode,
    sessionStatus,
    latestTurnState,
    messageCount,
    activityCount,
    hasPendingApproval,
    hasPendingUserInput,
    hasThreadError,
  } = candidate;
  if (
    !isNullableString(provider) ||
    !isNullableString(model) ||
    !isNullableString(projectKind) ||
    !isNullableString(environmentMode) ||
    !isNullableString(runtimeMode) ||
    !isNullableString(sessionStatus) ||
    !isNullableString(latestTurnState) ||
    typeof messageCount !== "number" ||
    typeof activityCount !== "number" ||
    typeof hasPendingApproval !== "boolean" ||
    typeof hasPendingUserInput !== "boolean" ||
    typeof hasThreadError !== "boolean"
  ) {
    return null;
  }
  return {
    provider,
    model,
    projectKind,
    environmentMode,
    runtimeMode,
    sessionStatus,
    latestTurnState,
    messageCount,
    activityCount,
    hasPendingApproval,
    hasPendingUserInput,
    hasThreadError,
  };
}

export const useFeedbackDialogStore = create<FeedbackDialogStore>((set) => ({
  isOpen: false,
  context: null,
  openDialog: (context) => set({ isOpen: true, context: readFeedbackThreadContext(context) }),
  setOpen: (open) => set(open ? { isOpen: true } : { isOpen: false, context: null }),
}));
