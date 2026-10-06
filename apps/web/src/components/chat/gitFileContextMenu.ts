import { showContextMenuFallback } from "~/contextMenuFallback";
import { GIT_FILE_CONTEXT_MENU_ICONS } from "~/lib/contextMenuIcons";
import { canRevertFile, type SourceFile } from "./GitFileList";
import type { GitFileSectionId } from "./gitFileSelection";

export function showGitFileContextMenu(
  section: GitFileSectionId,
  file: SourceFile,
  targets: SourceFile[],
  position: { x: number; y: number },
) {
  const count = targets.length;
  const action = section === "staged" ? "Unstage" : "Stage";
  return showContextMenuFallback(
    [
      ...(file.status === "D"
        ? []
        : [
            {
              id: "open" as const,
              label: "Open file",
              icon: GIT_FILE_CONTEXT_MENU_ICONS.open,
            },
          ]),
      {
        id: "action" as const,
        label: count === 1 ? action : `${action} ${count} files`,
        icon:
          section === "staged"
            ? GIT_FILE_CONTEXT_MENU_ICONS.unstage
            : GIT_FILE_CONTEXT_MENU_ICONS.stage,
        separatorBefore: true,
      },
      ...(targets.every((target) => target.status === "U")
        ? [
            {
              id: "ignore" as const,
              label: "Add to .gitignore",
              icon: GIT_FILE_CONTEXT_MENU_ICONS.ignore,
            },
          ]
        : []),
      ...(section === "unstaged" && targets.every(canRevertFile)
        ? [
            {
              id: "revert" as const,
              label: count === 1 ? "Revert changes" : `Revert ${count} files`,
              icon: GIT_FILE_CONTEXT_MENU_ICONS.revert,
              destructive: true,
            },
          ]
        : []),
    ],
    position,
  );
}
