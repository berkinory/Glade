// Primary sidebar navigation shared by classic and rail layouts.
export const SIDEBAR_NAV_ITEM_IDS = ["newThread", "kanban", "automations"] as const;

export type SidebarNavItemId = (typeof SIDEBAR_NAV_ITEM_IDS)[number];
