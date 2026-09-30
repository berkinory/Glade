import type { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import type { NewThreadOptions } from "./threadBootstrap";

export type StartContainerChatResult =
  | { ok: true; threadId: ThreadId | null }
  | { ok: false; error: string };

export async function startContainerChat(input: {
  readonly ensureProjectId: () => Promise<ProjectId | null>;
  readonly handleNewThread: (
    projectId: ProjectId,
    options?: NewThreadOptions,
  ) => Promise<ThreadId | null>;
  readonly fresh?: boolean | undefined;
  readonly standalone?: boolean | undefined;
  readonly errorLabel: string;
}): Promise<StartContainerChatResult> {
  try {
    const projectId = await input.ensureProjectId();
    if (!projectId) {
      return { ok: false, error: input.errorLabel };
    }
    const threadOptions: NewThreadOptions | undefined =
      input.fresh === true || input.standalone === true
        ? {
            ...(input.fresh === true ? { fresh: true } : {}),
            ...(input.standalone === true ? { standalone: true } : {}),
            envMode: "local",
            branch: null,
            worktreePath: null,
          }
        : undefined;
    const threadId = await input.handleNewThread(projectId, threadOptions);
    return { ok: true, threadId };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : input.errorLabel,
    };
  }
}
