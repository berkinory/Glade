// FILE: editorMetadata.ts
// Purpose: Resolve the shared web-facing labels and icons for supported editors.
// Layer: Web UI metadata
// Exports: editor option builders used by the chat header and open-in picker.

import { EDITORS, type EditorId } from "@glade/contracts";
import { EDITOR_ICON_ROUTE_PATH } from "@glade/shared/editorIcons";
import { createElement, useEffect, useState } from "react";
import type { Icon } from "./components/Icons";
import {
  AndroidStudioIcon,
  CLionIcon,
  CursorIcon,
  DataGripIcon,
  GhosttyIcon,
  GoLandIcon,
  IntelliJIdeaIcon,
  Iterm2Icon,
  PhpStormIcon,
  PyCharmIcon,
  RiderIcon,
  RubyMineIcon,
  SublimeTextIcon,
  TerminalAppIcon,
  VisualStudioCode,
  VscodiumIcon,
  WarpIcon,
  WebStormIcon,
  WindsurfIcon,
  XcodeIcon,
  ZedIndustriesIcon,
} from "./components/Icons";
import { FolderClosed } from "./components/FolderClosed";
import { AppsIcon } from "./lib/icons";
import { isMacPlatform, isWindowsPlatform } from "./lib/utils";
import { resolveWsHttpUrl } from "./lib/wsHttpUrl";

export interface EditorOption {
  readonly value: EditorId;
  readonly label: string;
  readonly Icon: Icon;
}

const FinderIcon: Icon = ({ className, style, ...props }) =>
  createElement(
    "svg",
    { ...props, className, style, viewBox: "0 0 1 1", xmlns: "http://www.w3.org/2000/svg" },
    createElement("image", {
      href: "/finder.png",
      width: 1,
      height: 1,
      preserveAspectRatio: "xMidYMid meet",
    }),
  );

const EDITOR_ICONS: Partial<Record<EditorId, Icon>> = {
  cursor: CursorIcon,
  vscode: VisualStudioCode,
  "vscode-insiders": VisualStudioCode,
  vscodium: VscodiumIcon,
  zed: ZedIndustriesIcon,
  windsurf: WindsurfIcon,
  sublime: SublimeTextIcon,
  ghostty: GhosttyIcon,
  terminal: TerminalAppIcon,
  iterm: Iterm2Icon,
  warp: WarpIcon,
  xcode: XcodeIcon,
  idea: IntelliJIdeaIcon,
  webstorm: WebStormIcon,
  pycharm: PyCharmIcon,
  phpstorm: PhpStormIcon,
  goland: GoLandIcon,
  clion: CLionIcon,
  rider: RiderIcon,
  rubymine: RubyMineIcon,
  datagrip: DataGripIcon,
  "android-studio": AndroidStudioIcon,
  // Windows and Linux retain the generic file-manager glyph.
  "file-manager": FolderClosed,
  "system-default": AppsIcon,
};

const NATIVE_EDITOR_ICON_COMPONENTS = new Map<EditorId, Icon>();
const loadedNativeIcons = new Set<EditorId>();

function resolveEditorNativeIconUrl(editorId: EditorId): string {
  const params = new URLSearchParams({ id: editorId });
  return resolveWsHttpUrl(`${EDITOR_ICON_ROUTE_PATH}?${params.toString()}`);
}

function resolveNativeEditorIcon(editorId: EditorId): Icon {
  const cached = NATIVE_EDITOR_ICON_COMPONENTS.get(editorId);
  if (cached) return cached;

  const FallbackIcon = resolveEditorIcon(editorId);
  const EditorNativeIcon: Icon = ({ className, style, ...props }) => {
    const [available, setAvailable] = useState(() => loadedNativeIcons.has(editorId));
    useEffect(() => {
      if (loadedNativeIcons.has(editorId)) return;
      const icon = new Image();
      let mounted = true;
      icon.onload = () => {
        loadedNativeIcons.add(editorId);
        if (mounted) setAvailable(true);
      };
      // A missing app or startup HTTP failure can recover later. Retry on remount.
      icon.src = resolveEditorNativeIconUrl(editorId);
      return () => {
        mounted = false;
      };
    }, []);
    if (!available) {
      return createElement(FallbackIcon, { className, style, ...props });
    }

    return createElement(
      "svg",
      {
        ...props,
        className,
        fill: "none",
        style,
        viewBox: "0 0 1 1",
        xmlns: "http://www.w3.org/2000/svg",
      },
      createElement("image", {
        height: 1,
        href: resolveEditorNativeIconUrl(editorId),
        preserveAspectRatio: "xMidYMid meet",
        width: 1,
      }),
    );
  };

  NATIVE_EDITOR_ICON_COMPONENTS.set(editorId, EditorNativeIcon);
  return EditorNativeIcon;
}

// Build labels from the shared catalog so newly supported editors appear without
// duplicating the editor list across multiple UI components.
function resolveEditorLabel(editorId: EditorId, platform: string): string {
  if (editorId === "file-manager") {
    return isMacPlatform(platform) ? "Finder" : isWindowsPlatform(platform) ? "Explorer" : "Files";
  }

  if (editorId === "system-default") {
    // macOS PDFs open in Preview by default; Windows/Linux use whatever viewer is
    // registered as the system handler, so keep the label generic off-Mac.
    return isMacPlatform(platform) ? "Preview" : "Default app";
  }

  return EDITORS.find((editor) => editor.id === editorId)?.label ?? editorId;
}

// Keep the header/picker resilient even when a brand-specific icon does not exist yet.
function resolveEditorIcon(editorId: EditorId): Icon {
  return EDITOR_ICONS[editorId] ?? AppsIcon;
}

function resolveEditorDisplayIcon(editorId: EditorId, platform: string): Icon {
  if (editorId === "file-manager" && isMacPlatform(platform)) return FinderIcon;
  // Bundled vector marks stay sharp at menu size and render on the first frame.
  // Only editors without a matching mark need an installed app icon lookup.
  return EDITOR_ICONS[editorId] ?? resolveNativeEditorIcon(editorId);
}

// Build a single option for an editor id that may not appear in the platform's
// installed-editor catalog (e.g. the always-available "system-default" opener that
// surfaces opt into without it being part of `availableEditors`).
export function resolveEditorOption(editorId: EditorId, platform: string): EditorOption {
  return {
    value: editorId,
    label: resolveEditorLabel(editorId, platform),
    Icon: resolveEditorDisplayIcon(editorId, platform),
  };
}

export function resolveAvailableEditorOptions(
  platform: string,
  availableEditors: ReadonlyArray<EditorId>,
): ReadonlyArray<EditorOption> {
  const availableEditorIds = new Set(availableEditors);
  return EDITORS.filter((editor) => availableEditorIds.has(editor.id)).map((editor) => ({
    value: editor.id,
    label: resolveEditorLabel(editor.id, platform),
    Icon: resolveEditorDisplayIcon(editor.id, platform),
  }));
}
