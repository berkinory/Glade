import { isRecord } from "@glade/shared/transport/payloadValues";

export type WorkspaceSplitDirection = "horizontal" | "vertical";
interface WorkspaceTabGroup {
  tabIds: string[];
  activeTabId: string | null;
  recentIds: string[];
}
export interface WorkspaceLayout {
  groups: WorkspaceTabGroup[];
  activeGroup: number;
  direction: WorkspaceSplitDirection;
  ratio: number;
}
export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = {
  groups: [{ tabIds: ["chat"], activeTabId: "chat", recentIds: ["chat"] }],
  activeGroup: 0,
  direction: "horizontal",
  ratio: 0.5,
};

function normalize(layout: WorkspaceLayout): WorkspaceLayout {
  const groups = layout.groups
    .filter((group) => group.tabIds.length > 0)
    .map((group) => {
      const recentIds = group.recentIds.filter((id) => group.tabIds.includes(id));
      return {
        ...group,
        recentIds,
        activeTabId:
          group.activeTabId && group.tabIds.includes(group.activeTabId)
            ? group.activeTabId
            : (recentIds[0] ?? group.tabIds[0]!),
      };
    });
  if (!groups.length) return DEFAULT_WORKSPACE_LAYOUT;
  const active = layout.groups[layout.activeGroup];
  return {
    ...layout,
    groups,
    activeGroup: Math.max(
      0,
      groups.findIndex((group) => group.tabIds.some((id) => active?.tabIds.includes(id))),
    ),
  };
}

export function sanitizeWorkspaceLayout(value: unknown): WorkspaceLayout {
  if (!isRecord(value) || !Array.isArray(value.groups)) return DEFAULT_WORKSPACE_LAYOUT;
  const seen = new Set<string>();
  const groups = value.groups.slice(0, 2).flatMap((group): WorkspaceTabGroup[] => {
    if (!isRecord(group) || !Array.isArray(group.tabIds)) return [];
    const tabIds = group.tabIds.filter((id): id is string => {
      if (typeof id !== "string" || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    return [
      {
        tabIds,
        activeTabId: typeof group.activeTabId === "string" ? group.activeTabId : null,
        recentIds: Array.isArray(group.recentIds)
          ? group.recentIds.filter((id): id is string => typeof id === "string")
          : [],
      },
    ];
  });
  if (!seen.has("chat")) groups[0]?.tabIds.unshift("chat");
  return normalize({
    groups,
    activeGroup: value.activeGroup === 1 ? 1 : 0,
    direction: value.direction === "vertical" ? "vertical" : "horizontal",
    ratio:
      typeof value.ratio === "number" && Number.isFinite(value.ratio)
        ? Math.max(0.2, Math.min(0.8, value.ratio))
        : 0.5,
  });
}

export function selectWorkspaceTab(layout: WorkspaceLayout, id: string): WorkspaceLayout {
  if (id === "terminal") return layout;
  const owner = layout.groups.findIndex((group) => group.tabIds.includes(id));
  const browserOwner =
    id === "browser" || id.startsWith("browser:")
      ? layout.groups.findIndex((group) =>
          group.tabIds.some((tab) => tab === "browser" || tab.startsWith("browser:")),
        )
      : -1;
  const activeGroup = owner >= 0 ? owner : browserOwner >= 0 ? browserOwner : layout.activeGroup;
  return {
    ...layout,
    activeGroup,
    groups: layout.groups.map((group, index) =>
      index !== activeGroup
        ? group
        : {
            tabIds: group.tabIds.includes(id) ? group.tabIds : [...group.tabIds, id],
            activeTabId: id,
            recentIds: [id, ...group.recentIds.filter((previous) => previous !== id)],
          },
    ),
  };
}

export function reconcileWorkspaceTabs(
  layout: WorkspaceLayout,
  ids: readonly string[],
  selected: string,
): WorkspaceLayout {
  const groups = layout.groups.map((group) => ({
    ...group,
    tabIds: group.tabIds.filter((id) => ids.includes(id)),
  }));
  const assigned = new Set(groups.flatMap((group) => group.tabIds));
  const target = groups[layout.activeGroup] ?? groups[0]!;
  for (const id of ids.filter((id) => !assigned.has(id))) {
    const browserOwner =
      id === "browser" || id.startsWith("browser:")
        ? groups.find((group) =>
            group.tabIds.some((tab) => tab === "browser" || tab.startsWith("browser:")),
          )
        : undefined;
    (browserOwner ?? target).tabIds.push(id);
  }
  const next = normalize({ ...layout, groups });
  // A closed tab falls back to its group's history, rather than selecting another group.
  return ids.includes(selected) ? selectWorkspaceTab(next, selected) : next;
}

export function moveWorkspaceTab(
  layout: WorkspaceLayout,
  id: string,
  target: number,
): WorkspaceLayout {
  if (!layout.groups[target]) return layout;
  const moving = id.startsWith("browser")
    ? layout.groups
        .flatMap((group) => group.tabIds)
        .filter((tab) => tab === "browser" || tab.startsWith("browser:"))
    : [id];
  const groups = layout.groups.map((group, index) => ({
    ...group,
    tabIds: [
      ...group.tabIds.filter((tab) => !moving.includes(tab)),
      ...(index === target ? moving : []),
    ],
  }));
  return normalize(selectWorkspaceTab({ ...layout, groups, activeGroup: target }, id));
}

export function splitWorkspaceTab(
  layout: WorkspaceLayout,
  id: string,
  direction: WorkspaceSplitDirection,
): WorkspaceLayout {
  const owner = layout.groups.findIndex((group) => group.tabIds.includes(id));
  if (owner < 0) return layout;
  if (layout.groups.length === 1 && layout.groups[0]!.tabIds.length < 2) return layout;
  if (layout.groups.length > 1) return { ...layout, direction };
  const groups = [...layout.groups, { tabIds: [], activeTabId: null, recentIds: [] }];
  return { ...moveWorkspaceTab({ ...layout, groups, direction }, id, 1), ratio: 0.5 };
}
