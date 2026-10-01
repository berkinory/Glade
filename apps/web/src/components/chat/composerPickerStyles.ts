import { MUTED_LABEL_TEXT_CLASS_NAME } from "~/surfaceStyles";

export const COMPOSER_SURFACE_SHADOW_CLASS_NAME =
  "shadow-[0_4px_18px_-6px_color-mix(in_srgb,var(--foreground)_7%,transparent)] dark:shadow-[0_6px_24px_-10px_rgba(0,0,0,0.30)]";

export const COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME =
  "text-ui-sm text-[var(--color-text-foreground-secondary)] sm:text-ui-sm font-normal hover:text-[var(--color-text-foreground)] data-pressed:text-[var(--color-text-foreground)]";

const COMPOSER_TOOLBAR_CAPSULE_HOVER_CLASS_NAME =
  "rounded-full transition-colors hover:bg-[var(--color-background-button-secondary-hover)]";

export const COMPOSER_FOLDER_PICKER_CAPSULE_HOVER_CLASS_NAME = `${COMPOSER_TOOLBAR_CAPSULE_HOVER_CLASS_NAME} group-hover/project-picker-trigger:bg-[var(--color-background-button-secondary-hover)]`;

export const COMPOSER_TOOLBAR_TRIGGER_TEXT_CLASS_NAME =
  "text-ui-sm text-[var(--color-text-foreground)] sm:text-ui-sm font-normal";

export const COMPOSER_TOOLBAR_PICKER_TRIGGER_CLASS_NAME = `inline-flex cursor-pointer items-center gap-1.5 px-2 py-1 ${COMPOSER_TOOLBAR_CAPSULE_HOVER_CLASS_NAME} ${COMPOSER_TOOLBAR_TRIGGER_TEXT_CLASS_NAME}`;

export const COMPOSER_PICKER_MODEL_SUBMENU_HEIGHT_CLASS_NAME =
  "[--available-height:min(20rem,55vh)]";

export const COMPOSER_PICKER_SEARCH_HEADER_CLASS_NAME =
  "sticky z-20 shrink-0 border-b border-[color:color-mix(in_srgb,var(--foreground)_6%,transparent)] bg-transparent px-1.5 pb-1.5 pt-1";

export const COMPOSER_PICKER_SEARCH_INPUT_CLASS_NAME =
  "rounded-lg border-[color:color-mix(in_srgb,var(--foreground)_8%,transparent)] bg-[color-mix(in_srgb,white_92%,transparent)] shadow-none before:hidden has-focus-visible:border-[color:color-mix(in_srgb,var(--foreground)_14%,transparent)] has-focus-visible:ring-0 [&_input]:font-sans [&_input]:placeholder:text-muted-foreground/55";

export const COMPOSER_PICKER_MODEL_LIST_MAX_HEIGHT_CLASS_NAME =
  "max-h-[min(var(--available-height,20rem),20rem)]";

export const COMPOSER_PICKER_MODEL_LIST_SCROLL_CLASS_NAME = "composer-picker-scroll";

export const COMPOSER_PICKER_RADIUS_CLASS_NAME = "rounded-[0.875rem]";

export const COMPOSER_PICKER_OPTION_RADIUS_CLASS_NAME = "rounded-[0.625rem]";

export const COMPOSER_PICKER_MODEL_GROUP_HEADER_CLASS_NAME = `grid w-full grid-cols-[0.75rem_minmax(0,1fr)_2.5rem] items-center gap-x-1.5 ${COMPOSER_PICKER_RADIUS_CLASS_NAME} px-2 py-1 text-left text-ui-xs font-medium text-muted-foreground/80 outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)] focus-visible:ring-0`;

export const COMPOSER_MUTED_ACCENT_TEXT_CLASS_NAME = MUTED_LABEL_TEXT_CLASS_NAME;

const COMPOSER_MAX_WIDTH_CLASS_NAME = "max-w-[var(--app-chat-max-width,46rem)]";

export const CHAT_BACKGROUND_CLASS_NAME = "bg-[var(--color-background-surface)]";

// Apply this surface to opaque content only; a raised transparent SidebarInset would intercept
// sidebar input. The content-seam rail owns the sole divider and resize hit area.
export const CHAT_CONTENT_CARD_CLASS_NAME = "chat-content-card relative z-[15] overflow-hidden";

export const CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME = `${CHAT_BACKGROUND_CLASS_NAME} ${CHAT_CONTENT_CARD_CLASS_NAME}`;

export const CHAT_ROUTE_INSET_SHELL_CLASS_NAME =
  "h-dvh min-h-0 overflow-hidden overscroll-y-none text-foreground";

export const CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME =
  "flex h-dvh min-h-0 min-w-0 flex-1 overflow-hidden";

export const CHAT_COLUMN_GUTTER_CLASS_NAME =
  "px-[var(--app-density-chat-gutter-x,0.75rem)] sm:px-[var(--app-density-chat-gutter-x-lg,1.25rem)]";

export const CHAT_COLUMN_FRAME_CLASS_NAME = `mx-auto w-full min-w-0 ${COMPOSER_MAX_WIDTH_CLASS_NAME}`;

export const COMPOSER_STACKED_HEADER_FRAME_CLASS_NAME = "mx-auto -mb-px w-14/15 min-w-0";

// Deliberately has NO background: the composer floats over the scrolling transcript (see
// `composerOverlay.ts`) and its frosted material is meant to reveal and blur the content passing
// behind it — an opaque backing here would be the only thing its `backdrop-filter` ever sampled.
// `relative z-[1]` keeps the full input outline above the inset stacked rail (`-mb-px`), so the top
// border is never covered by live-changes / task / queue chrome.
export const COMPOSER_INPUT_SHELL_CLASS_NAME =
  "group relative z-[1] chat-composer-shell transition-colors duration-100";

const RAISED_SURFACE_BORDER_CLASS_NAME = "border-[color:var(--surface-border)]";

export const COMPOSER_STACKED_SURFACE_BORDER_CLASS_NAME =
  "border-[color:var(--composer-stacked-border)]";

export const COMPOSER_INPUT_SURFACE_CLASS_NAME = `chat-composer-surface border ${RAISED_SURFACE_BORDER_CLASS_NAME} ${COMPOSER_SURFACE_SHADOW_CLASS_NAME} transition-colors duration-100`;

export const APP_TRANSLUCENT_POPUP_SURFACE_BASE_CLASS_NAME =
  "relative overflow-hidden border border-border bg-popover/70 text-popover-foreground before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150";

export const APP_TRANSLUCENT_POPUP_SURFACE_CLASS_NAME = `${APP_TRANSLUCENT_POPUP_SURFACE_BASE_CLASS_NAME} rounded-2xl shadow-xl`;

export const APP_TOOLTIP_SURFACE_CLASS_NAME = `${APP_TRANSLUCENT_POPUP_SURFACE_BASE_CLASS_NAME} rounded-lg shadow-xl`;

const COMPOSER_PICKER_MENU_SURFACE_CHROME_CLASS_NAME = `border border-border ${COMPOSER_PICKER_RADIUS_CLASS_NAME} ${COMPOSER_SURFACE_SHADOW_CLASS_NAME}`;

export const COMPOSER_PICKER_MENU_SURFACE_CLASS_NAME = `${APP_TRANSLUCENT_POPUP_SURFACE_BASE_CLASS_NAME} ${COMPOSER_PICKER_MENU_SURFACE_CHROME_CLASS_NAME}`;

export const COMPOSER_PICKER_MENU_POPUP_BODY_CLASS_NAME = `relative z-1 w-full min-w-0 overflow-y-auto overscroll-contain ${COMPOSER_PICKER_MODEL_LIST_SCROLL_CLASS_NAME}`;

export const COMPOSER_PICKER_MENU_POPUP_VIEWPORT_CLASS_NAME =
  "relative min-w-(--anchor-width) max-h-[min(var(--available-height),28rem)]";

export const COMPOSER_PICKER_MENU_OPTION_CLASS_NAME = `[&>svg,&>[data-slot=central-icon]]:-mx-0.5 flex cursor-default select-none items-center ${COMPOSER_PICKER_OPTION_RADIUS_CLASS_NAME} text-ui text-[var(--color-text-foreground)] outline-none data-disabled:pointer-events-none data-highlighted:bg-[var(--color-background-button-secondary-hover)] data-highlighted:text-[var(--color-text-foreground)] data-disabled:opacity-64 [&>svg:not([class*='opacity-']),&>[data-slot=central-icon]:not([class*='opacity-'])]:opacity-80 [&>svg,&>[data-slot=central-icon]]:pointer-events-none [&>svg,&>[data-slot=central-icon]]:shrink-0`;

export const COMPOSER_PICKER_SELECT_OPTION_CLASS_NAME = `${COMPOSER_PICKER_MENU_OPTION_CLASS_NAME} grid in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)]`;

export const COMPOSER_PICKER_TOOLTIP_SURFACE_CLASS_NAME = `${COMPOSER_PICKER_MENU_SURFACE_CLASS_NAME} font-normal text-[var(--color-text-foreground)]`;

export const COMPOSER_COMMAND_MENU_SURFACE_CLASS_NAME =
  "relative overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground";

export const ENVIRONMENT_PANEL_SURFACE_CLASS_NAME = `relative overflow-hidden rounded-2xl border ${RAISED_SURFACE_BORDER_CLASS_NAME} bg-popover text-popover-foreground ${COMPOSER_SURFACE_SHADOW_CLASS_NAME}`;

export const ENVIRONMENT_PANEL_MOTION_CLASS =
  "transition-[transform,opacity] duration-120 ease-out motion-reduce:transition-none";

export const ENVIRONMENT_CONTENT_INSET_MOTION_CLASS =
  "transition-[padding-right] duration-120 ease-out motion-reduce:transition-none";

export const COMPOSER_COMMAND_MENU_FLOATING_WRAPPER_CLASS_NAME =
  "pointer-events-auto absolute inset-x-0 bottom-full z-20 mb-2 overflow-visible px-1 pt-2";

export const COMPOSER_COMMAND_MENU_ITEM_CLASS_NAME =
  "flex cursor-pointer select-none items-center gap-2 rounded-xl px-2 py-1 transition-colors hover:bg-[var(--color-background-button-secondary-hover)] data-highlighted:bg-[var(--color-background-button-secondary-hover)]";

export const COMPOSER_COMMAND_MENU_ITEM_ACTIVE_CLASS_NAME =
  "bg-[var(--color-background-button-secondary)] text-[var(--color-text-foreground)]";

export const COMPOSER_INPUT_SURFACE_BANNER_CLASS_NAME = `chat-composer-surface-banner border-b ${RAISED_SURFACE_BORDER_CLASS_NAME} bg-[var(--color-background-elevated-secondary)]`;

export const COMPOSER_INLINE_ACTION_PILL_CLASS_NAME =
  "shrink-0 rounded-md border border-[color:var(--color-border-light)] px-2.5 py-0.5 text-foreground/90 transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground";

export const RUNTIME_FULL_ACCESS_ACCENT_CLASS_NAME =
  "text-[var(--runtime-full-access-accent)] hover:opacity-85";

export const RUNTIME_AUTO_ACCENT_CLASS_NAME = "text-[var(--color-text-accent)] hover:opacity-85";
export const RUNTIME_AUTO_ICON_ACCENT_CLASS_NAME = "text-[var(--color-text-accent)]";

export const COMPOSER_EDITOR_LINE_HEIGHT_CLASS_NAME = "leading-relaxed";
export const COMPOSER_EDITOR_TEXT_CLASS_NAME = "text-chat";

export const COMPOSER_EDITOR_TYPOGRAPHY_CLASS_NAME = `font-system-ui ${COMPOSER_EDITOR_TEXT_CLASS_NAME} ${COMPOSER_EDITOR_LINE_HEIGHT_CLASS_NAME}`;

export const COMPOSER_PLACEHOLDER_TEXT_CLASS_NAME = "text-muted-foreground/40";
export const COMPOSER_EDITOR_MIN_HEIGHT_CLASS_NAME =
  "min-h-[var(--app-density-composer-editor-min-height,2lh)]";

export const COMPOSER_EDITOR_CONTENT_RESET_CLASS_NAME = "[&_p]:m-0";

export const COMPOSER_EDITOR_PADDING_CLASS_NAME = [
  "relative",
  "pl-[var(--app-density-composer-editor-padding-x,0.75rem)]",
  "pr-[var(--app-density-composer-editor-padding-x-end,0.875rem)]",
  "pt-[var(--app-density-composer-editor-padding-top,0.75rem)]",
  "pb-[var(--app-density-composer-editor-padding-bottom,0.5rem)]",
].join(" ");

export const COMPOSER_FOOTER_ROW_CLASS_NAME = [
  "flex items-center justify-between",
  "pl-[var(--app-density-composer-footer-padding,0.375rem)]",
  "pr-[var(--app-density-composer-footer-padding-end,0.5rem)]",
  "pb-[var(--app-density-composer-footer-padding,0.375rem)]",
].join(" ");
