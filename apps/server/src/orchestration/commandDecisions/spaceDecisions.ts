import type { OrchestrationCommand } from "@glade/contracts/orchestration/commands";
import { Effect } from "effect";
import {
  requireSpaceAbsent,
  requireSpaceNameAvailable,
  listActiveSpaces,
  requireSpace,
  requireProject,
  requireSpaceAssignableProject,
} from "../commandInvariants.ts";
import {
  RESERVED_VOID_SPACE_ID,
  SPACES_MAX_COUNT,
} from "@glade/contracts/orchestration/threadEntities";
import { OrchestrationCommandInvariantError } from "../Errors.ts";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import {
  CommandDecisionInput,
  CommandDecisionEffect,
  withEventBase,
  nowIso,
} from "./commandEvents";

export function decideSpaceCommand({
  command,
  readModel,
  workspacePaths,
}: CommandDecisionInput<
  Extract<
    OrchestrationCommand,
    {
      type:
        | "space.create"
        | "space.meta.update"
        | "space.reorder"
        | "space.delete"
        | "space.projects.assign";
    }
  >
>): CommandDecisionEffect {
  return Effect.gen(function* () {
    switch (command.type) {
      case "space.create": {
        yield* requireSpaceAbsent({ readModel, command, spaceId: command.spaceId });
        if (command.spaceId === RESERVED_VOID_SPACE_ID) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "The reserved Void identity cannot be used for a custom space.",
          });
        }
        yield* requireSpaceNameAvailable({ readModel, command, name: command.name });
        const activeSpaces = listActiveSpaces(readModel);
        if (activeSpaces.length >= SPACES_MAX_COUNT) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `A maximum of ${SPACES_MAX_COUNT} custom spaces is supported.`,
          });
        }
        const sortOrder = activeSpaces.reduce(
          (maximum, space) => Math.max(maximum, space.sortOrder + 1),
          0,
        );
        return {
          ...withEventBase({
            aggregateKind: "space",
            aggregateId: command.spaceId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "space.created",
          payload: {
            spaceId: command.spaceId,
            name: command.name,
            icon: command.icon,
            sortOrder,
            createdAt: command.createdAt,
            updatedAt: command.createdAt,
          },
        };
      }
      case "space.meta.update": {
        const existingSpace = yield* requireSpace({ readModel, command, spaceId: command.spaceId });
        // Fields equal to the current value are not changes: a Save with nothing edited (or a rename that
        // resends the icon) must not append an event or bump updatedAt.
        const nextName =
          command.name !== undefined && command.name !== existingSpace.name
            ? command.name
            : undefined;
        const nextIcon =
          command.icon !== undefined && command.icon !== existingSpace.icon
            ? command.icon
            : undefined;
        if (nextName === undefined && nextIcon === undefined) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Space metadata update must change a name or icon.",
          });
        }
        if (nextName !== undefined) {
          yield* requireSpaceNameAvailable({
            readModel,
            command,
            name: nextName,
            excludeSpaceId: command.spaceId,
          });
        }
        const occurredAt = nowIso();
        return {
          ...withEventBase({
            aggregateKind: "space",
            aggregateId: command.spaceId,
            occurredAt,
            commandId: command.commandId,
          }),
          type: "space.meta-updated",
          payload: {
            spaceId: command.spaceId,
            ...(nextName !== undefined ? { name: nextName } : {}),
            ...(nextIcon !== undefined ? { icon: nextIcon } : {}),
            updatedAt: occurredAt,
          },
        };
      }
      case "space.reorder": {
        yield* requireSpace({ readModel, command, spaceId: command.spaceId });
        const activeSpaceIds = listActiveSpaces(readModel).map((space) => space.id);
        const orderedSpaceIds = command.orderedSpaceIds;
        const orderedSpaceIdSet = new Set(orderedSpaceIds);
        const hasExactActiveSet =
          orderedSpaceIds.length === activeSpaceIds.length &&
          orderedSpaceIdSet.size === activeSpaceIds.length &&
          activeSpaceIds.every((spaceId) => orderedSpaceIdSet.has(spaceId));
        if (!hasExactActiveSet) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Space order must contain every active custom space exactly once.",
          });
        }
        const occurredAt = nowIso();
        return {
          ...withEventBase({
            aggregateKind: "space",
            aggregateId: command.spaceId,
            occurredAt,
            commandId: command.commandId,
          }),
          type: "space.order-updated",
          payload: {
            spaceId: command.spaceId,
            orderedSpaceIds,
            updatedAt: occurredAt,
          },
        };
      }
      case "space.delete": {
        yield* requireSpace({ readModel, command, spaceId: command.spaceId });
        const occurredAt = nowIso();
        // The deletion event owns the re-filing invariant. Projectors clear every matching assignment in
        // one pass, avoiding an unbounded event fanout for large spaces while still including soft-deleted
        // projects that a recovery flow could resurrect.
        return {
          ...withEventBase({
            aggregateKind: "space",
            aggregateId: command.spaceId,
            occurredAt,
            commandId: command.commandId,
          }),
          type: "space.deleted",
          payload: { spaceId: command.spaceId, deletedAt: occurredAt },
        };
      }
      case "space.projects.assign": {
        yield* requireSpace({ readModel, command, spaceId: command.spaceId });
        const occurredAt = nowIso();
        const seenProjectIds = new Set<string>();
        const events: Array<Omit<OrchestrationEvent, "sequence">> = [];
        for (const projectId of command.projectIds) {
          if (seenProjectIds.has(projectId)) continue;
          seenProjectIds.add(projectId);
          const project = yield* requireProject({ readModel, command, projectId });
          // Already-filed and concurrently-deleted projects are settled, not errors: the batch stays atomic
          // for real failures without rejecting a raced retry.
          if (project.deletedAt !== null || project.spaceId === command.spaceId) continue;
          if ((project.kind ?? "project") !== "project") {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: "Only ordinary projects can be assigned to a space.",
            });
          }
          yield* requireSpaceAssignableProject({
            command,
            projectTitle: project.title,
            projectWorkspaceRoot: project.workspaceRoot,
            workspacePaths,
          });
          events.push({
            ...withEventBase({
              aggregateKind: "project",
              aggregateId: project.id,
              occurredAt,
              commandId: command.commandId,
            }),
            type: "project.meta-updated" as const,
            payload: {
              projectId: project.id,
              spaceId: command.spaceId,
              updatedAt: occurredAt,
            },
          });
        }
        if (events.length === 0) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "None of the selected projects need to be assigned to this space.",
          });
        }
        return events;
      }
    }
  });
}
