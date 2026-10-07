import { renderToStaticMarkup } from "react-dom/server";
import {
  Archive04Icon,
  ArrowLeftRightIcon,
  BellIcon,
  ComputerTerminal01Icon,
  Copy01Icon,
  CursorInWindowIcon,
  Delete02Icon,
  FilePlusIcon,
  FileXIcon,
  Folder02Icon,
  FolderPlusIcon,
  HashIcon,
  MessageCircleIcon,
  MinusIcon,
  PencilEdit02Icon,
  PinIcon,
  PlusIcon,
  TextIcon,
  UndoIcon,
  ViewIcon,
} from "./icons";

export const THREAD_CONTEXT_MENU_ICONS = {
  rename: renderToStaticMarkup(<PencilEdit02Icon size={24} />),
  pin: renderToStaticMarkup(<PinIcon size={24} />),
  clearNotification: renderToStaticMarkup(<BellIcon size={24} />),
  markUnread: renderToStaticMarkup(<ViewIcon size={24} />),
  computerUse: renderToStaticMarkup(<CursorInWindowIcon size={24} />),
  handoff: renderToStaticMarkup(<ArrowLeftRightIcon size={24} />),
  copy: renderToStaticMarkup(<Copy01Icon size={24} />),
  openInTerminal: renderToStaticMarkup(<ComputerTerminal01Icon size={24} />),
  archive: renderToStaticMarkup(<Archive04Icon size={24} />),
  delete: renderToStaticMarkup(<Delete02Icon size={24} />),
} as const;

export const FILE_CONTEXT_MENU_ICONS = {
  reference: renderToStaticMarkup(<MessageCircleIcon size={24} />),
  copy: renderToStaticMarkup(<Copy01Icon size={24} />),
  finder: "/finder.png",
  fileManager: renderToStaticMarkup(<Folder02Icon size={24} />),
  createFile: renderToStaticMarkup(<FilePlusIcon size={24} />),
  createFolder: renderToStaticMarkup(<FolderPlusIcon size={24} />),
  rename: renderToStaticMarkup(<PencilEdit02Icon size={24} />),
  delete: renderToStaticMarkup(<Delete02Icon size={24} />),
} as const;

export const GIT_FILE_CONTEXT_MENU_ICONS = {
  ignore: renderToStaticMarkup(<FileXIcon size={24} />),
  open: renderToStaticMarkup(<ViewIcon size={24} />),
  stage: renderToStaticMarkup(<PlusIcon size={24} />),
  unstage: renderToStaticMarkup(<MinusIcon size={24} />),
  revert: renderToStaticMarkup(<UndoIcon size={24} />),
} as const;

export const GIT_COMMIT_CONTEXT_MENU_ICONS = {
  undo: renderToStaticMarkup(<UndoIcon size={24} />),
  hash: renderToStaticMarkup(<Copy01Icon size={24} />),
  shortHash: renderToStaticMarkup(<HashIcon size={24} />),
  subject: renderToStaticMarkup(<TextIcon size={24} />),
} as const;
