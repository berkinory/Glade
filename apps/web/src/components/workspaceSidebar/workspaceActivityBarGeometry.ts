import { CHAT_SURFACE_HEADER_HEIGHT_PX } from "@glade/shared/platform/desktopChrome";

const BUTTON_SIZE_PX = 32;
export const WORKSPACE_ACTIVITY_SEPARATOR_GAP_PX = 10;

// Measured from the header's bottom edge, including the relocated toggle on Windows/Linux.
export function workspaceActivitySeparatorOffset(captionButtonsOverlap: boolean): number {
  return captionButtonsOverlap
    ? BUTTON_SIZE_PX + WORKSPACE_ACTIVITY_SEPARATOR_GAP_PX * 2
    : WORKSPACE_ACTIVITY_SEPARATOR_GAP_PX - (CHAT_SURFACE_HEADER_HEIGHT_PX - BUTTON_SIZE_PX) / 2;
}
