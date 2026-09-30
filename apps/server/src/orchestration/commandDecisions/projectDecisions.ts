import type { ProjectKind } from "@glade/contracts/workspace/project";
import type { OrchestrationReadModel } from "@glade/contracts/orchestration/snapshots";
import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import { Effect } from "effect";
import { OrchestrationCommandInvariantError } from "../Errors.ts";
import { MAX_PINNED_PROJECTS } from "@glade/contracts/orchestration/threadEntities";
import {
  requireProjectAbsent,
  listActiveProjectsByWorkspaceRoot,
  listThreadsByProjectId,
  findSpaceById,
  isLegacyHomeChatContainerRow,
  requireProject,
  requireSpaceAssignableProject,
  requireSpace,
  requireProjectWorkspaceRootAvailable,
  requireProjectHasNoThreads,
} from "../commandInvariants.ts";
import { workspaceRootsEqual } from "@glade/shared/threads/threadWorkspace";
import { withProjectRelocationEvents } from "../projectRelocation.ts";
import {
  CommandDecisionInput,
  CommandDecisionEffect,
  withEventBase,
  nowIso,
} from "./commandEvents";

const WORKSPACE_OWNING_PROJECT_KIND_SET = new Set<ProjectKind>(["project"]);

function countPinnedProjects(
  readModel: OrchestrationReadModel,
  options?: { readonly excludeProjectIds?: ReadonlySet<string> },
): number {
  return readModel.projects.filter(
    (project) =>
      project.deletedAt === null &&
      project.kind === "project" &&
      project.isPinned === true &&
      !options?.excludeProjectIds?.has(project.id),
  ).length;
}

function validateProjectPinLimit(input: {
  readonly command: Extract<
    OrchestrationCommand,
    { type: "project.create" | "project.meta.update" }
  >;
  readonly readModel: OrchestrationReadModel;
  readonly projectId: OrchestrationEvent["aggregateId"];
  readonly nextKind: ProjectKind;
  readonly nextDeletedAt?: string | null;
  readonly wasPinned?: boolean;
  readonly staleProjectIds?: ReadonlySet<string>;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  // The kind invariant must hold for the EFFECTIVE pin state, not only when the command sets
  // isPinned: a kind-only update would otherwise carry an existing pin onto a kind that can never be
  // pinned.
  const nextIsPinned = input.command.isPinned ?? input.wasPinned ?? false;
  if (nextIsPinned && input.nextKind !== "project") {
    return Effect.fail(
      new OrchestrationCommandInvariantError({
        commandType: input.command.type,
        detail: `Only projects can be pinned.`,
      }),
    );
  }

  if (input.command.isPinned !== true) {
    return Effect.void;
  }

  if (input.nextDeletedAt !== undefined && input.nextDeletedAt !== null) {
    return Effect.fail(
      new OrchestrationCommandInvariantError({
        commandType: input.command.type,
        detail: `Deleted project '${input.projectId}' cannot be pinned.`,
      }),
    );
  }

  if (input.wasPinned === true) {
    return Effect.void;
  }

  const excludeProjectIds = new Set<string>([input.projectId, ...(input.staleProjectIds ?? [])]);
  const pinnedProjectCount = countPinnedProjects(input.readModel, { excludeProjectIds });
  if (pinnedProjectCount < MAX_PINNED_PROJECTS) {
    return Effect.void;
  }

  return Effect.fail(
    new OrchestrationCommandInvariantError({
      commandType: input.command.type,
      detail: `Only ${MAX_PINNED_PROJECTS} projects can be pinned at once.`,
    }),
  );
}

export function decideProjectCommand({
  command,
  readModel,
  workspacePaths,
}: CommandDecisionInput<
  Extract<
    OrchestrationCommand,
    { type: "project.create" | "project.meta.update" | "project.delete" }
  >
>): CommandDecisionEffect {
  return Effect.gen(function* () {
    switch (command.type) {
      case "project.create": {
        yield* requireProjectAbsent({
          readModel,
          command,
          projectId: command.projectId,
        });
        const events: Array<Omit<OrchestrationEvent, "sequence">> = [];
        const staleProjects: Array<OrchestrationReadModel["projects"][number]> = [];
        const nextProjectKind = command.kind ?? "project";
        if (nextProjectKind === "project") {
          const existingProjects = listActiveProjectsByWorkspaceRoot(
            readModel,
            command.workspaceRoot,
          );
          for (const existingProject of existingProjects) {
            const remainingThreads = listThreadsByProjectId(readModel, existingProject.id).filter(
              (thread) => thread.deletedAt === null,
            );
            if (remainingThreads.length > 0 || command.preserveExistingProject) {
              return yield* new OrchestrationCommandInvariantError({
                commandType: command.type,
                detail: `Project '${existingProject.id}' already uses workspace root '${existingProject.workspaceRoot}'.`,
              });
            }
            staleProjects.push(existingProject);
          }

          for (const staleProject of staleProjects) {
            events.push({
              ...withEventBase({
                aggregateKind: "project",
                aggregateId: staleProject.id,
                occurredAt: command.createdAt,
                commandId: command.commandId,
              }),
              type: "project.deleted",
              payload: {
                projectId: staleProject.id,
                deletedAt: command.createdAt,
              },
            });
          }
        }
        yield* validateProjectPinLimit({
          command,
          readModel,
          projectId: command.projectId,
          nextKind: nextProjectKind,
          staleProjectIds: new Set(staleProjects.map((project) => project.id)),
        });

        // Filing a new project into the requested space is best-effort: creation must never fail because
        // the space raced a delete, so an unusable target degrades to Void.
        const requestedSpace =
          command.spaceId != null ? findSpaceById(readModel, command.spaceId) : undefined;
        const creationSpaceId =
          command.spaceId != null &&
          nextProjectKind === "project" &&
          requestedSpace !== undefined &&
          requestedSpace.deletedAt === null &&
          !isLegacyHomeChatContainerRow({
            projectTitle: command.title,
            projectWorkspaceRoot: command.workspaceRoot,
            workspacePaths,
          })
            ? command.spaceId
            : null;

        events.push({
          ...withEventBase({
            aggregateKind: "project",
            aggregateId: command.projectId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "project.created",
          payload: {
            projectId: command.projectId,
            kind: nextProjectKind,
            title: command.title,
            workspaceRoot: command.workspaceRoot,
            defaultModelSelection: command.defaultModelSelection ?? null,
            scripts: [],
            isPinned: command.isPinned,
            spaceId: creationSpaceId,
            createdAt: command.createdAt,
            updatedAt: command.createdAt,
          },
        });
        return events.length === 1 ? events[0]! : events;
      }
      case "project.meta.update": {
        const existingProject = yield* requireProject({
          readModel,
          command,
          projectId: command.projectId,
        });
        const nextProjectKind = command.kind ?? existingProject.kind ?? "project";
        const requestedSpaceId =
          command.spaceId !== undefined
            ? command.spaceId
            : nextProjectKind !== "project" && existingProject.spaceId !== null
              ? null
              : undefined;
        const effectiveSpaceId =
          requestedSpaceId !== undefined ? requestedSpaceId : existingProject.spaceId;
        const changedSpaceId =
          requestedSpaceId !== undefined && requestedSpaceId !== existingProject.spaceId
            ? requestedSpaceId
            : undefined;
        const hasOtherMetadataInput =
          command.kind !== undefined ||
          command.title !== undefined ||
          command.workspaceRoot !== undefined ||
          command.defaultModelSelection !== undefined ||
          command.scripts !== undefined ||
          command.isPinned !== undefined;
        const isLegacyHomeChatContainer = isLegacyHomeChatContainerRow({
          projectTitle: existingProject.title,
          projectWorkspaceRoot: existingProject.workspaceRoot,
          workspacePaths,
        });
        if (
          command.title !== undefined &&
          command.title !== existingProject.title &&
          isLegacyHomeChatContainer
        ) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "The legacy Chats container cannot be renamed.",
          });
        }
        if (
          command.workspaceRoot !== undefined &&
          !workspaceRootsEqual(command.workspaceRoot, existingProject.workspaceRoot, {
            platform: process.platform,
          }) &&
          isLegacyHomeChatContainer
        ) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "The legacy Chats container workspace root cannot be changed.",
          });
        }
        if (effectiveSpaceId !== null) {
          // Assignability is an invariant of the resulting row, not only of commands that explicitly set
          // spaceId. Metadata-only updates must not turn an already-filed project into the legacy Home/Chats
          // container while retaining its space.
          yield* requireSpaceAssignableProject({
            command,
            projectTitle: command.title ?? existingProject.title,
            projectWorkspaceRoot: command.workspaceRoot ?? existingProject.workspaceRoot,
            workspacePaths,
          });
        }
        if (command.spaceId !== undefined && command.spaceId !== null) {
          if (existingProject.deletedAt !== null) {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: "Deleted projects cannot be assigned to a space.",
            });
          }
          if (nextProjectKind !== "project") {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: "Only ordinary projects can be assigned to a space.",
            });
          }
          yield* requireSpace({ readModel, command, spaceId: command.spaceId });
        }
        if (
          requestedSpaceId !== undefined &&
          changedSpaceId === undefined &&
          !hasOtherMetadataInput
        ) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Project is already assigned to this space.",
          });
        }

        const ownershipMayChange =
          command.workspaceRoot !== undefined ||
          (command.kind !== undefined && command.kind !== (existingProject.kind ?? "project"));
        if (ownershipMayChange && nextProjectKind !== "chat") {
          yield* requireProjectWorkspaceRootAvailable({
            readModel,
            command,
            workspaceRoot: command.workspaceRoot ?? existingProject.workspaceRoot,
            excludeProjectId: command.projectId,
            kinds: WORKSPACE_OWNING_PROJECT_KIND_SET,
          });
        }
        yield* validateProjectPinLimit({
          command,
          readModel,
          projectId: command.projectId,
          nextKind: nextProjectKind,
          nextDeletedAt: existingProject.deletedAt,
          wasPinned: existingProject.isPinned === true,
        });
        const occurredAt = nowIso();
        const event = {
          ...withEventBase({
            aggregateKind: "project",
            aggregateId: command.projectId,
            occurredAt,
            commandId: command.commandId,
          }),
          type: "project.meta-updated",
          payload: {
            projectId: command.projectId,
            ...(command.kind !== undefined ? { kind: command.kind } : {}),
            ...(command.title !== undefined ? { title: command.title } : {}),
            ...(command.workspaceRoot !== undefined
              ? { workspaceRoot: command.workspaceRoot }
              : {}),
            ...(command.defaultModelSelection !== undefined
              ? { defaultModelSelection: command.defaultModelSelection }
              : {}),
            ...(command.scripts !== undefined ? { scripts: command.scripts } : {}),
            ...(command.isPinned !== undefined ? { isPinned: command.isPinned } : {}),
            ...(changedSpaceId !== undefined ? { spaceId: changedSpaceId } : {}),
            updatedAt: occurredAt,
          },
        } satisfies Omit<Extract<OrchestrationEvent, { type: "project.meta-updated" }>, "sequence">;
        return yield* withProjectRelocationEvents({
          event,
          previousProject: existingProject,
          readModel,
        });
      }
      case "project.delete": {
        yield* requireProject({
          readModel,
          command,
          projectId: command.projectId,
        });
        yield* requireProjectHasNoThreads({
          readModel,
          command,
          projectId: command.projectId,
        });
        const occurredAt = nowIso();
        return {
          ...withEventBase({
            aggregateKind: "project",
            aggregateId: command.projectId,
            occurredAt,
            commandId: command.commandId,
          }),
          type: "project.deleted",
          payload: {
            projectId: command.projectId,
            deletedAt: occurredAt,
          },
        };
      }
    }
  });
}
