import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { create } from "zustand";

// Only whether each thread's panel is open. Tabs live on the desktop for the app's lifetime and
// reach the panel over the server, so this state is not persisted either.
interface BrowserPanelStore {
  readonly openByThreadId: Readonly<Record<ThreadId, true>>;
  readonly setOpen: (threadId: ThreadId, open: boolean) => void;
  readonly toggle: (threadId: ThreadId) => void;
}

export const useBrowserPanelStore = create<BrowserPanelStore>((set, get) => ({
  openByThreadId: {},
  setOpen: (threadId, open) =>
    set(({ openByThreadId }) => {
      if (openByThreadId[threadId] === (open || undefined)) return {};
      const { [threadId]: _closed, ...rest } = openByThreadId;
      return { openByThreadId: open ? { ...rest, [threadId]: true } : rest };
    }),
  toggle: (threadId) => get().setOpen(threadId, get().openByThreadId[threadId] !== true),
}));
