import { type ComponentProps, useCallback, useEffect, useRef, useState } from "react";

import { Input } from "~/components/ui/input";

type DebouncedSettingTextInputProps = Omit<
  ComponentProps<typeof Input>,
  "value" | "onChange" | "defaultValue"
> & {
  value: string;

  onCommit: (value: string) => void;
  debounceMs?: number;
};

export function DebouncedSettingTextInput({
  value,
  onCommit,
  debounceMs: debounceMsProp,
  onBlur,
  onFocus,
  ...inputProps
}: DebouncedSettingTextInputProps) {
  const debounceMs = debounceMsProp ?? 200;
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDraftRef = useRef(value);

  const valueRef = useRef(value);
  const onCommitRef = useRef(onCommit);
  useEffect(() => {
    valueRef.current = value;
    onCommitRef.current = onCommit;
  }, [value, onCommit]);

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(value);
      latestDraftRef.current = value;
    }
  }, [value]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const flush = useCallback(() => {
    clearTimer();
    if (latestDraftRef.current !== valueRef.current) {
      onCommitRef.current(latestDraftRef.current);
    }
  }, [clearTimer]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        if (latestDraftRef.current !== valueRef.current) {
          onCommitRef.current(latestDraftRef.current);
        }
      }
    },
    [],
  );

  return (
    <Input
      {...inputProps}
      value={draft}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        latestDraftRef.current = next;
        clearTimer();
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          onCommitRef.current(next);
        }, debounceMs);
      }}
      onFocus={(event) => {
        focusedRef.current = true;
        onFocus?.(event);
      }}
      onBlur={(event) => {
        focusedRef.current = false;
        flush();
        onBlur?.(event);
      }}
    />
  );
}
