import type { FilesystemBrowseEntry } from "@glade/contracts/workspace/filesystem";
import { useEffect, useId, useState, type KeyboardEvent } from "react";
import type { EnvironmentKey } from "~/environments/environmentKey";
import { FolderIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { ensureEnvironmentNativeApi } from "~/nativeApi";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";

const BROWSE_DEBOUNCE_MS = 120;

// The segment after the last separator decides what is listed, like a shell completion. Hidden
// folders only appear once the user types a leading dot, so a fresh "~/" is not a wall of dotfiles.
function visibleEntries(
  path: string,
  entries: ReadonlyArray<FilesystemBrowseEntry>,
): ReadonlyArray<FilesystemBrowseEntry> {
  const segment = path.slice(path.lastIndexOf("/") + 1);
  return segment.startsWith(".") ? entries : entries.filter((entry) => !entry.name.startsWith("."));
}

// A path field that browses folders on an SSH host as the user types: the system folder picker can
// only see this machine. Choosing a folder descends into it; Enter on a typed path submits.
export function HostFolderField(props: {
  readonly id: string;
  readonly environmentKey: EnvironmentKey;
  readonly value: string;
  readonly invalid: boolean;
  readonly placeholder: string;
  readonly className?: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
}) {
  const listId = useId();
  const [entries, setEntries] = useState<ReadonlyArray<FilesystemBrowseEntry>>([]);
  const [highlighted, setHighlighted] = useState(-1);
  const [focused, setFocused] = useState(false);
  const { environmentKey, value } = props;

  useEffect(() => {
    if (!focused) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const partialPath = value.trim() || "~/";
      void ensureEnvironmentNativeApi(environmentKey)
        .filesystem.browse({ partialPath })
        .then((result) => {
          if (cancelled) return;
          setEntries(visibleEntries(partialPath, result.entries));
          setHighlighted(-1);
        })
        // A folder that does not exist yet lists nothing; the host creates it when the project is added.
        .catch(() => {
          if (!cancelled) setEntries([]);
        });
    }, BROWSE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [environmentKey, focused, value]);

  const choose = (entry: FilesystemBrowseEntry) => props.onChange(`${entry.fullPath}/`);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (entries.length === 0) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlighted((index) => (index + step + entries.length) % entries.length);
      return;
    }
    const entry = entries[highlighted];
    if ((event.key === "Enter" || event.key === "Tab") && entry) {
      event.preventDefault();
      choose(entry);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      props.onSubmit();
    }
  };

  const open = focused && entries.length > 0;
  return (
    <div className="space-y-1.5">
      <InputGroup className={props.className}>
        <InputGroupAddon className="w-10 self-stretch border-e border-foreground/12 ps-0">
          <FolderIcon className="size-4 text-muted-foreground/70" aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          id={props.id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Folder on the host"
          aria-invalid={props.invalid ? true : undefined}
          placeholder={props.placeholder}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          value={value}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </InputGroup>
      {open ? (
        <div
          id={listId}
          role="listbox"
          className="max-h-44 overflow-y-auto rounded-lg border border-foreground/12 p-1"
        >
          {entries.map((entry, index) => (
            <div
              key={entry.fullPath}
              role="option"
              aria-selected={index === highlighted}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-ui-sm",
                index === highlighted ? "bg-accent text-foreground" : "text-muted-foreground",
                "hover:bg-accent hover:text-foreground",
              )}
              // Keeps focus in the field so the list stays open while descending.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(entry)}
            >
              <FolderIcon aria-hidden className="size-3.5 shrink-0 opacity-70" />
              <span className="truncate">{entry.name}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
