import { COMPACT_CHAT_MARKDOWN_TIGHT_CLASS_NAME } from "~/components/chatMarkdownSpacing";
import { COMPOSER_STACKED_SURFACE_BORDER_CLASS_NAME } from "./composerPickerStyles";

export const COMPOSER_STACKED_PANEL_CHROME_CLASS_NAME = [
  "chat-composer-stacked-top relative overflow-hidden border border-b-0",
  COMPOSER_STACKED_SURFACE_BORDER_CLASS_NAME,
].join(" ");

export const COMPOSER_STACKED_PANEL_DIVIDER_CLASS_NAME = `border-t ${COMPOSER_STACKED_SURFACE_BORDER_CLASS_NAME}`;

export const COMPOSER_NOTICE_CONTENT_CLASS_NAME = "px-4 py-3 text-ui-sm leading-snug";

export const COMPOSER_STACKED_PANEL_ROW_CLASS_NAME =
  "flex items-center gap-2 px-2.5 py-1.5 text-ui";

export const COMPOSER_STACKED_PANEL_ROW_COMPACT_CLASS_NAME =
  "flex items-center gap-2 px-2.5 py-1 text-ui";

export const COMPOSER_STACKED_PANEL_HEADER_ROW_CLASS_NAME =
  "flex items-center justify-between gap-2 px-2.5 py-1.5";

export const COMPOSER_STACKED_PANEL_ROW_MAIN_CLASS_NAME =
  "flex min-w-0 flex-1 items-center gap-1.5";

export const COMPOSER_STACKED_PANEL_ICON_CLASS_NAME =
  "size-3.5 shrink-0 text-[var(--color-text-foreground-secondary)]";

export const COMPOSER_STACKED_PANEL_LABEL_CLASS_NAME = "truncate font-medium text-foreground/85";

export const COMPOSER_STACKED_PANEL_PREVIEW_MARKDOWN_CLASS_NAME = [
  "line-clamp-1 max-h-[1.25rem] overflow-hidden text-ui font-medium !text-foreground/85",
  "[&_p]:truncate [&_p]:whitespace-nowrap",
  COMPACT_CHAT_MARKDOWN_TIGHT_CLASS_NAME,
].join(" ");

export const COMPOSER_STACKED_PANEL_META_CLASS_NAME = "truncate text-ui text-muted-foreground/80";

export const COMPOSER_STACKED_PANEL_BODY_PADDING_CLASS_NAME = "px-2.5 pb-1.5";

export const COMPOSER_STACKED_PANEL_SCROLL_REGION_CLASS_NAME =
  "max-h-56 overflow-y-auto overscroll-contain";

export const COMPOSER_STACKED_PANEL_FOOTER_ROW_CLASS_NAME =
  "flex items-center justify-between gap-2 px-2.5 py-1.5 text-ui-sm text-muted-foreground/70";

export const COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME =
  "size-5 rounded-md text-[var(--color-text-foreground-tertiary)] hover:bg-[var(--color-background-button-secondary-hover)] hover:text-[var(--color-text-foreground)]";
