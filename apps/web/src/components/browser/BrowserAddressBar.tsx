import { useState, type ReactNode } from "react";
import { ArrowLeft02Icon, ArrowRight02Icon, RefreshCwIcon } from "~/lib/icons";
import { IconButton } from "../ui/icon-button";
import { Input } from "../ui/input";
import type { BrowserTab } from "./useBrowserTabs";

export function BrowserAddressBar(props: {
  tab: BrowserTab | null;
  onOpen: (url: string) => void;
  onHistory: (history: "back" | "forward" | "reload") => void;
  // Page actions after the address field.
  children?: ReactNode;
}) {
  const { tab } = props;
  // What the user is typing, kept per tab so page navigations do not overwrite it mid-edit.
  const [draft, setDraft] = useState<{ tabId: string | null; url: string } | null>(null);
  const tabId = tab?.tabId ?? null;
  const editing = draft !== null && draft.tabId === tabId;
  const shownUrl = tab?.url === "about:blank" ? "" : (tab?.url ?? "");
  const value = editing ? draft.url : shownUrl;

  return (
    <form
      className="flex items-center gap-1 px-2 py-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        const url = value.trim();
        if (!url) return;
        setDraft(null);
        props.onOpen(url);
      }}
    >
      <IconButton label="Back" disabled={!tab?.canGoBack} onClick={() => props.onHistory("back")}>
        <ArrowLeft02Icon className="size-3.5" />
      </IconButton>
      <IconButton
        label="Forward"
        disabled={!tab?.canGoForward}
        onClick={() => props.onHistory("forward")}
      >
        <ArrowRight02Icon className="size-3.5" />
      </IconButton>
      <IconButton label="Reload" disabled={!tab} onClick={() => props.onHistory("reload")}>
        <RefreshCwIcon className="size-3.5" />
      </IconButton>
      <Input
        size="sm"
        variant="soft"
        className="min-w-0 flex-1"
        aria-label="Address"
        placeholder="Enter address"
        spellCheck={false}
        autoComplete="off"
        value={value}
        onChange={(event) => setDraft({ tabId, url: event.currentTarget.value })}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setDraft(null);
            event.currentTarget.blur();
          }
        }}
      />
      {props.children}
    </form>
  );
}
