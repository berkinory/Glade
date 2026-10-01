export const SIDEBAR_NAV_ITEM_IDS = ["newThread"] as const;

export type SidebarNavItemId = (typeof SIDEBAR_NAV_ITEM_IDS)[number];
