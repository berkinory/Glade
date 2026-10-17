import { Cause, Effect, Layer, Option } from "effect";
import { resolveThreadWorkspaceState } from "@glade/shared/threads/threadEnvironment";

import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ServerSettingsService } from "../../settings/serverSettings.ts";
import { providerStartOptionsFromServerSettings } from "../../settings/settingsPatches";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  ThreadSessionPrewarm,
  type ThreadSessionPrewarmShape,
} from "../Services/ThreadSessionPrewarm.ts";

const makeThreadSessionPrewarm = Effect.gen(function* () {
  const projections = yield* ProjectionSnapshotQuery;
  const providerService = yield* ProviderService;
  const serverSettings = yield* ServerSettingsService;

  // Builds the same start input a fresh session gets from the turn's ensure step, so the provider can
  // hand the prewarmed runtime to that start. Anything this cannot predict is skipped.
  const prewarm: ThreadSessionPrewarmShape["prewarm"] = (input) =>
    Effect.gen(function* () {
      if (!providerService.prewarmSession) return;
      const provider = input.modelSelection.provider;
      const settings = yield* serverSettings.getSettings;
      if (!settings.providers[provider].enabled) return;

      const thread = Option.getOrUndefined(yield* projections.getThreadShellById(input.threadId));
      if (thread) {
        if (
          thread.archivedAt ||
          thread.parentThreadId ||
          thread.handoff?.stage === "pending" ||
          (thread.forkSourceThreadId && thread.latestTurn === null) ||
          (thread.session !== null && thread.session.status !== "stopped")
        ) {
          return;
        }
        const establishedProvider =
          thread.latestTurn !== null ? thread.session?.providerName : null;
        if (establishedProvider && establishedProvider !== provider) return;
      }
      const workspace =
        thread ??
        (input.draft && {
          projectId: input.draft.projectId,
          envMode: "local" as const,
          worktreePath: null,
          workingDirectory: input.draft.workingDirectory,
        });
      if (!workspace || resolveThreadWorkspaceState(workspace) === "worktree-pending") return;
      const project = Option.getOrUndefined(
        yield* projections.getProjectShellById(workspace.projectId),
      );
      if (!project) return;
      const cwd = resolveThreadWorkspaceCwd({ thread: workspace, projects: [project] });

      yield* providerService.prewarmSession(input.threadId, {
        threadId: input.threadId,
        provider,
        ...(cwd ? { cwd } : {}),
        modelSelection: input.modelSelection,
        providerOptions: providerStartOptionsFromServerSettings(settings),
        runtimeMode: input.runtimeMode,
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logDebug("thread session prewarm skipped", {
          threadId: input.threadId,
          cause: Cause.pretty(cause),
        }),
      ),
    );

  return { prewarm } satisfies ThreadSessionPrewarmShape;
});

export const ThreadSessionPrewarmLive = Layer.effect(
  ThreadSessionPrewarm,
  makeThreadSessionPrewarm,
);
