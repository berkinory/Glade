import { APP_TOOLTIP_SURFACE_CLASS_NAME } from "./chat/composerPickerStyles";
import { TOOLTIP_OPEN_DELAY_MS } from "./ui/tooltip";

export const SIDEBAR_HOVER_CARD_CONTAINER_PADDING_CLASS_NAME = "p-0.5";

const SIDEBAR_HOVER_CARD_ROW_PADDING_CLASS_NAME = "px-1.5 py-1";

export const SIDEBAR_HOVER_CARD_ROW_CLASS_NAME = `flex w-full min-w-0 items-center gap-2.5 rounded-md ${SIDEBAR_HOVER_CARD_ROW_PADDING_CLASS_NAME} text-ui-sm leading-none`;

export const SIDEBAR_HOVER_CARD_SURFACE_CLASS_NAME = `${APP_TOOLTIP_SURFACE_CLASS_NAME} w-[16rem]`;

export const SIDEBAR_HOVER_CARD_TRIGGER_PROPS = {
  delay: TOOLTIP_OPEN_DELAY_MS,
  closeDelay: 0,
} as const;

// Popup placement spread onto BOTH cards' popups so they anchor, offset, and stack identically. The
// negative side offset overlaps the popup with its row, removing the gap the pointer would
// otherwise cross. `z-[100]` lifts the cards above the app's z-[90] surfaces while staying under
// modals (z-[200]+).
export const SIDEBAR_HOVER_CARD_POPUP_PROPS = {
  side: "right",
  align: "start",
  sideOffset: -2,
  positionerClassName: "z-[100]",
} as const;
