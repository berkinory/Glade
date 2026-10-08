import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import { rememberProjectState, resetStaleRememberedProjectState } from "./storePersistence";
import {
  resetThreadDetailResumeCursors,
  retainThreadDetailResumeCursors,
} from "./threadDetailResumeCursors";
import { initializeVisitScope } from "./threadVisitPersistence";
import type { Project } from "./types";

// What applying a server snapshot does outside the store. The local environment persists project UI
// state and visit scope; an SSH host's store must leave both alone, or every host snapshot would wipe
// what the local server's projects remembered.
export interface StoreSideEffects {
  // True when the server's persistence scope changed and the store must start over empty.
  enterPersistenceScope(scope: string | undefined): boolean;
  rememberProjects(projects: readonly Project[]): void;
  forgetProjectsMissingFrom(cwdKeys: ReadonlySet<string>): void;
  resetResumeCursors(): void;
  retainResumeCursors(threadIds: ReadonlySet<ThreadId>): void;
}

export const LOCAL_STORE_SIDE_EFFECTS: StoreSideEffects = {
  enterPersistenceScope: initializeVisitScope,
  rememberProjects: rememberProjectState,
  forgetProjectsMissingFrom: resetStaleRememberedProjectState,
  resetResumeCursors: resetThreadDetailResumeCursors,
  retainResumeCursors: retainThreadDetailResumeCursors,
};

export const REMOTE_STORE_SIDE_EFFECTS: StoreSideEffects = {
  enterPersistenceScope: () => false,
  rememberProjects: () => undefined,
  forgetProjectsMissingFrom: () => undefined,
  resetResumeCursors: () => undefined,
  retainResumeCursors: () => undefined,
};
