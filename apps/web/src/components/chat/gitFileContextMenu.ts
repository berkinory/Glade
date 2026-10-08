import { FileXIcon, MinusIcon, PlusIcon, UndoIcon, ViewIcon } from "~/lib/icons";
import { showContextMenu } from "~/components/contextMenu/contextMenuStore";
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
  return showContextMenu(
    [
      ...(file.status === "D"
        ? []
        : [
            {
              id: "open" as const,
              label: "Open file",
              icon: ViewIcon,
            },
          ]),
      {
        id: "action" as const,
        label: count === 1 ? action : `${action} ${count} files`,
        icon: section === "staged" ? MinusIcon : PlusIcon,
        separatorBefore: true,
      },
      ...(targets.every((target) => target.status === "U")
        ? [
            {
              id: "ignore" as const,
              label: "Add to .gitignore",
              icon: FileXIcon,
            },
          ]
        : []),
      ...(section === "unstaged" && targets.every(canRevertFile)
        ? [
            {
              id: "revert" as const,
              label: count === 1 ? "Revert changes" : `Revert ${count} files`,
              icon: UndoIcon,
              destructive: true,
            },
          ]
        : []),
    ],
    position,
  );
}
