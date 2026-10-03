import type { OrchestrationReadModel } from "@glade/contracts/orchestration/snapshots";
import type { OrchestrationEvent } from "@glade/contracts/orchestration/events";
import {
  SpaceCreatedPayload,
  SpaceMetaUpdatedPayload,
  SpaceOrderUpdatedPayload,
  SpaceDeletedPayload,
  ProjectCreatedPayload,
  ProjectMetaUpdatedPayload,
  ProjectDeletedPayload,
} from "../Schemas.ts";
import { Effect } from "effect";
import { ProjectionEffect, decodeForEvent } from "./projectionState";

export function projectWorkspaceEvent(
  nextBase: OrchestrationReadModel,
  event: Extract<
    OrchestrationEvent,
    {
      type:
        | "space.created"
        | "space.meta-updated"
        | "space.order-updated"
        | "space.deleted"
        | "project.created"
        | "project.meta-updated"
        | "project.deleted";
    }
  >,
): ProjectionEffect {
  switch (event.type) {
    case "space.created":
      return decodeForEvent(SpaceCreatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const existing = nextBase.spaces.find((entry) => entry.id === payload.spaceId);
          const nextSpace = {
            id: payload.spaceId,
            name: payload.name,
            icon: payload.icon,
            sortOrder: payload.sortOrder,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
            deletedAt: null,
          };
          return {
            ...nextBase,
            spaces: existing
              ? nextBase.spaces.map((entry) => (entry.id === payload.spaceId ? nextSpace : entry))
              : [...nextBase.spaces, nextSpace],
          };
        }),
      );
    case "space.meta-updated":
      return decodeForEvent(SpaceMetaUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          spaces: nextBase.spaces.map((space) =>
            space.id === payload.spaceId
              ? {
                  ...space,
                  ...(payload.name !== undefined ? { name: payload.name } : {}),
                  ...(payload.icon !== undefined ? { icon: payload.icon } : {}),
                  updatedAt: payload.updatedAt,
                }
              : space,
          ),
        })),
      );
    case "space.order-updated":
      return decodeForEvent(SpaceOrderUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const orderBySpaceId = new Map(
            payload.orderedSpaceIds.map((spaceId, index) => [spaceId, index] as const),
          );
          return {
            ...nextBase,
            spaces: nextBase.spaces.map((space) => {
              const sortOrder = orderBySpaceId.get(space.id);

              return sortOrder === undefined || sortOrder === space.sortOrder
                ? space
                : { ...space, sortOrder, updatedAt: payload.updatedAt };
            }),
          };
        }),
      );
    case "space.deleted":
      return decodeForEvent(SpaceDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          spaces: nextBase.spaces.map((space) =>
            space.id === payload.spaceId
              ? { ...space, deletedAt: payload.deletedAt, updatedAt: payload.deletedAt }
              : space,
          ),
          projects: nextBase.projects.map((project) =>
            project.spaceId === payload.spaceId
              ? {
                  ...project,
                  spaceId: null,
                  updatedAt:
                    project.updatedAt > payload.deletedAt ? project.updatedAt : payload.deletedAt,
                }
              : project,
          ),
        })),
      );
    case "project.created":
      return decodeForEvent(ProjectCreatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const existing = nextBase.projects.find((entry) => entry.id === payload.projectId);
          const nextProject = {
            id: payload.projectId,
            kind: payload.kind,
            title: payload.title,
            workspaceRoot: payload.workspaceRoot,
            defaultModelSelection: payload.defaultModelSelection,
            isPinned: payload.isPinned ?? false,
            spaceId: payload.spaceId ?? null,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
            deletedAt: null,
          };

          return {
            ...nextBase,
            projects: existing
              ? nextBase.projects.map((entry) =>
                  entry.id === payload.projectId ? nextProject : entry,
                )
              : [...nextBase.projects, nextProject],
          };
        }),
      );
    case "project.meta-updated":
      return decodeForEvent(ProjectMetaUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          projects: nextBase.projects.map((project) =>
            project.id === payload.projectId
              ? {
                  ...project,
                  ...(payload.kind !== undefined ? { kind: payload.kind } : {}),
                  ...(payload.title !== undefined ? { title: payload.title } : {}),
                  ...(payload.workspaceRoot !== undefined
                    ? { workspaceRoot: payload.workspaceRoot }
                    : {}),
                  ...(payload.defaultModelSelection !== undefined
                    ? { defaultModelSelection: payload.defaultModelSelection }
                    : {}),
                  ...(payload.isPinned !== undefined ? { isPinned: payload.isPinned } : {}),
                  ...(payload.spaceId !== undefined ? { spaceId: payload.spaceId } : {}),
                  updatedAt: payload.updatedAt,
                }
              : project,
          ),
        })),
      );
    case "project.deleted":
      return decodeForEvent(ProjectDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          projects: nextBase.projects.map((project) =>
            project.id === payload.projectId
              ? {
                  ...project,
                  deletedAt: payload.deletedAt,
                  updatedAt: payload.deletedAt,
                }
              : project,
          ),
        })),
      );
  }
}
