// FILE: contextMenuIcons.tsx
// Purpose: Icons for imperative context menus, matching the glyphs the same actions use in React UI.
// Layer: web UI utility
// Exports: THREAD_CONTEXT_MENU_ICONS
// Why: Native menus cannot render React components, so Central glyphs are passed by basename and
//      other icon sets are rendered to SVG markup from the same components the app shows.

import { renderToStaticMarkup } from "react-dom/server";
import { IconFilePlus, IconFileOff } from "@tabler/icons-react";

import { THREAD_ARCHIVE_ICON } from "~/components/ThreadArchiveActionButton";
import {
  BELL_ICON_NAME,
  COPY_ICON_NAME,
  EYE_OPEN_ICON_NAME,
  HANDOFF_ICON_NAME,
  PENCIL_ICON_NAME,
  PIN_ICON_NAME,
  PlusIcon,
  MinusIcon,
  RotateCcwIcon,
  TERMINAL_ICON_NAME,
  Trash2,
} from "./icons";

export const THREAD_CONTEXT_MENU_ICONS = {
  rename: PENCIL_ICON_NAME,
  pin: PIN_ICON_NAME,
  clearNotification: BELL_ICON_NAME,
  markUnread: EYE_OPEN_ICON_NAME,
  handoff: HANDOFF_ICON_NAME,
  copy: COPY_ICON_NAME,
  openInTerminal: TERMINAL_ICON_NAME,
  // Same glyph as the thread row's hover archive button.
  archive: renderToStaticMarkup(<THREAD_ARCHIVE_ICON size={24} />),
  // Same glyph as the delete rows in the sidebar project and space menus.
  delete: renderToStaticMarkup(<Trash2 />),
} as const;

export const FILE_CONTEXT_MENU_ICONS = {
  reference: "chat-bubble-7",
  copy: COPY_ICON_NAME,
  finder: "/finder.png",
  fileManager: "folder-open-front",
  createFile: renderToStaticMarkup(<IconFilePlus size={24} />),
  createFolder: "folder-add-left",
  rename: PENCIL_ICON_NAME,
  delete: renderToStaticMarkup(<Trash2 />),
} as const;

export const GIT_FILE_CONTEXT_MENU_ICONS = {
  ignore: renderToStaticMarkup(<IconFileOff size={24} />),
  open: EYE_OPEN_ICON_NAME,
  stage: renderToStaticMarkup(<PlusIcon className="size-4" />),
  unstage: renderToStaticMarkup(<MinusIcon className="size-4" />),
  revert: renderToStaticMarkup(<RotateCcwIcon className="size-4" />),
} as const;
