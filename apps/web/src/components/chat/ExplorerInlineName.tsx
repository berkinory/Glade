import { useEffect, useRef, useState } from "react";

import { FileEntryIcon } from "./FileEntryIcon";
import { fileRowIndentStyle } from "./fileRowStyles";

export function ExplorerInlineName(props: {
  kind: "file" | "directory";
  path: string;
  depth: number;
  initialName: string;
  creating: boolean;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(props.initialName);
  const inputRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const cancelled = useRef(false);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const extension = props.kind === "file" ? props.initialName.lastIndexOf(".") : -1;
    input.setSelectionRange(0, extension > 0 ? extension : props.initialName.length);
  }, [props.initialName, props.kind]);
  const submit = async () => {
    if (submitting.current || cancelled.current) return;
    if (!name.trim()) {
      props.onCancel();
      return;
    }
    submitting.current = true;
    try {
      await props.onSubmit(name);
    } finally {
      submitting.current = false;
    }
  };
  return (
    <div
      className="flex h-7 min-w-0 items-center gap-1.5 pr-2 text-ui"
      style={fileRowIndentStyle(props.depth)}
    >
      {props.kind === "directory" && !props.creating ? (
        <span className="size-3.5 shrink-0" />
      ) : null}
      <FileEntryIcon pathValue={props.path} kind={props.kind} className="size-3.5 shrink-0" />
      <input
        ref={inputRef}
        value={name}
        aria-label={
          props.creating
            ? `New ${props.kind === "directory" ? "folder" : "file"} name`
            : `Rename ${props.kind}`
        }
        className="h-6 min-w-0 flex-1 rounded-sm border border-[var(--color-border-focus)] bg-background px-1 text-ui text-foreground outline-none"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelled.current = true;
            props.onCancel();
          }
        }}
        onBlur={() => void submit()}
      />
    </div>
  );
}
