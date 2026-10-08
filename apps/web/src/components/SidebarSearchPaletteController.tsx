import { useMemo } from "react";
import { useStore } from "../store";
import { createAllThreadsSelector, createSidebarDisplayThreadsSelector } from "../storeSelectors";
import { useStableValue } from "~/hooks/useStableValue";
import { type Thread } from "../types";
import type { SettingsSectionId } from "../settingsNavigation";
import { SidebarSearchPalette } from "./SidebarSearchPalette";
import {
  areSidebarSearchThreadListsEqual,
  type SidebarSearchAction,
  type SidebarSearchProject,
  type SidebarSearchThread,
} from "./SidebarSearchPalette.logic";

const searchPaletteMessagesByThreadMessages = new WeakMap<
  Thread["messages"],
  SidebarSearchThread["messages"]
>();

function searchPaletteMessagesFor(thread: Thread): SidebarSearchThread["messages"] {
  const cached = searchPaletteMessagesByThreadMessages.get(thread.messages);
  if (cached) {
    return cached;
  }
  const projected = thread.messages.map((message) => ({ text: message.text }));
  searchPaletteMessagesByThreadMessages.set(thread.messages, projected);
  return projected;
}

export function SidebarSearchPaletteController(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: readonly SidebarSearchAction[];
  projects: readonly SidebarSearchProject[];
  onCreateChat: () => void;
  onCreateThread: () => void;
  onAddProjectPath: (path: string, options?: { createIfMissing?: boolean }) => Promise<void>;
  homeDir: string | null;
  onOpenSettings: (section: SettingsSectionId, target: string | null) => void;
  onOpenProject: (projectId: string) => void;
  onOpenThread: (threadId: string) => void;
}) {
  const selectAllThreads = useMemo(() => createAllThreadsSelector(), []);

  const selectSidebarDisplayThreads = useMemo(() => createSidebarDisplayThreadsSelector(), []);
  const threads = useStore(selectAllThreads);
  const sidebarDisplayThreads = useStore(selectSidebarDisplayThreads);
  const rebuiltSearchPaletteThreads = useMemo<SidebarSearchThread[]>(() => {
    const threadById = new Map(threads.map((thread) => [thread.id, thread] as const));
    const searchProjectById = new Map(
      props.projects.map((project) => [project.id, project] as const),
    );
    return sidebarDisplayThreads.flatMap((threadSummary) => {
      const thread = threadById.get(threadSummary.id);
      if (!thread) {
        return [];
      }
      const searchProject = searchProjectById.get(thread.projectId);

      return [
        {
          id: thread.id,
          title: thread.title,
          projectId: thread.projectId,
          projectName: searchProject?.name ?? "",
          projectRemoteName: searchProject?.remoteName ?? "",
          spaceName: searchProject?.spaceName ?? "Global",
          provider: thread.modelSelection.provider,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
          messages: searchPaletteMessagesFor(thread),
        },
      ];
    });
  }, [props.projects, sidebarDisplayThreads, threads]);
  const searchPaletteThreads = useStableValue(
    rebuiltSearchPaletteThreads,
    areSidebarSearchThreadListsEqual,
  );

  return (
    <SidebarSearchPalette
      open={props.open}
      onOpenChange={props.onOpenChange}
      actions={props.actions}
      projects={props.projects}
      threads={searchPaletteThreads}
      onCreateChat={props.onCreateChat}
      onCreateThread={props.onCreateThread}
      onAddProjectPath={props.onAddProjectPath}
      homeDir={props.homeDir}
      onOpenSettings={props.onOpenSettings}
      onOpenProject={props.onOpenProject}
      onOpenThread={props.onOpenThread}
    />
  );
}
