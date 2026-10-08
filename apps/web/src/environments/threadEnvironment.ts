import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { useLayoutEffect } from "react";
import { useComposerDraftStore } from "../composerDraftStore";
import { useStore } from "../store";
import { setActiveEnvironment } from "./activeEnvironment";
import { LOCAL_ENVIRONMENT, type EnvironmentKey } from "./environmentKey";
import { environmentOfProject, environmentOfThread } from "./environmentStores";

// A server thread belongs to the environment whose store has it; a draft to its project's.
function useThreadEnvironment(threadId: ThreadId | null): EnvironmentKey {
  const draftProjectId = useComposerDraftStore((state) =>
    threadId ? (state.draftThreadsByThreadId[threadId]?.projectId ?? null) : null,
  );
  return useStore(() => {
    if (!threadId) return LOCAL_ENVIRONMENT;
    return (
      environmentOfThread(threadId) ??
      (draftProjectId ? environmentOfProject(draftProjectId) : null) ??
      LOCAL_ENVIRONMENT
    );
  });
}

// Makes the routed chat's environment the active one while it is on screen.
export function useActiveThreadEnvironment(threadId: ThreadId | null): EnvironmentKey {
  const environmentKey = useThreadEnvironment(threadId);
  useLayoutEffect(() => {
    setActiveEnvironment(environmentKey);
    return () => setActiveEnvironment(LOCAL_ENVIRONMENT);
  }, [environmentKey]);
  return environmentKey;
}
