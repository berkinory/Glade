import { useEffect, useRef, useState } from "react";

export interface CommitDraftOptions {
  readonly value: string;

  readonly onCommit: (value: string) => void;

  readonly validate?: ((value: string) => string | null) | undefined;

  readonly normalize?: ((value: string) => string) | undefined;

  readonly flushOnUnmount?: boolean | undefined;
}

export interface CommitDraft {
  readonly draft: string;
  readonly setDraft: (next: string) => void;

  readonly commit: () => void;

  readonly revert: () => void;

  readonly error: string | null;
}

export function useCommitDraft({
  value,
  onCommit,
  validate,
  normalize,
  flushOnUnmount = true,
}: CommitDraftOptions): CommitDraft {
  const [draftState, setDraftState] = useState<{ base: string; value: string } | null>(null);
  const draft = draftState !== null && draftState.base === value ? draftState.value : value;
  const setDraft = (next: string) => setDraftState({ base: value, value: next });

  const normalized = normalize ? normalize(draft) : draft;
  const isCommittable = normalized !== value && (!validate || validate(normalized) === null);
  const latest = useRef({ isCommittable, normalized, onCommit, flushOnUnmount });

  const clearPendingFlush = () => {
    latest.current = { ...latest.current, isCommittable: false };
  };

  const commit = () => {
    clearPendingFlush();
    if (isCommittable) {
      onCommit(normalized);
    }
    setDraftState(null);
  };
  const revert = () => {
    clearPendingFlush();
    setDraftState(null);
  };

  // Flush a valid pending draft on unmount. The ref is written in an effect — never during render —
  // so a render React discards (StrictMode, interrupted concurrent render) can't leak its values into
  // the cleanup; the flush always sees the last *committed* draft.
  useEffect(() => {
    latest.current = { isCommittable, normalized, onCommit, flushOnUnmount };
  });
  useEffect(
    () => () => {
      const current = latest.current;
      if (current.flushOnUnmount && current.isCommittable) {
        current.onCommit(current.normalized);
      }
    },
    [],
  );

  return { draft, setDraft, commit, revert, error: validate ? validate(normalized) : null };
}

export function useCommitDraftBlurHandlers(draft: Pick<CommitDraft, "commit" | "revert">): {
  readonly onBlur: () => void;

  readonly revertAndBlur: (element: { blur(): void }) => void;
} {
  const revertingRef = useRef(false);
  return {
    onBlur: () => {
      if (revertingRef.current) {
        revertingRef.current = false;
        draft.revert();
        return;
      }
      draft.commit();
    },
    revertAndBlur: (element) => {
      revertingRef.current = true;
      element.blur();
    },
  };
}
