import { Copy01Icon } from "~/lib/icons";
import type { EditorId } from "@glade/contracts/settings/editor";
import type { ResolvedKeybindingsConfig } from "@glade/contracts/settings/keybindings";
import type { CSSProperties } from "react";
import { useCopyPathToClipboard } from "~/hooks/useCopyToClipboard";
import { splitRepoRelativePath } from "~/lib/diffRendering";
import { cn } from "~/lib/utils";
import { MenuItem } from "../ui/menu";
import { DiffStatLabel } from "./DiffStatLabel";
import { FileEntryIcon } from "./FileEntryIcon";
import { OpenInPicker } from "./OpenInPicker";
import {
  isLocalAbsolutePath,
  isWorkspaceRelativePathSafe,
  joinWorkspaceRelativePath,
  workspaceRelativePathOf,
} from "@glade/shared/platform/path";
interface EditedFileRowProps {
  file: {
    path: string;
    kind: string;
    additions: number;
    deletions: number;
    workspaceRoot: string | undefined;
  };
  editorConfig: {
    keybindings: ResolvedKeybindingsConfig | undefined;
    availableEditors: ReadonlyArray<EditorId> | undefined;
  };
  appearance: {
    theme: "light" | "dark";
    fontSize: CSSProperties["fontSize"];
    withFirstReset: boolean;
  };
  onReview: () => void;
}
// A fixed height in the chat font's em lets the turn's file list cap itself at a row count.
export const EDITED_FILE_ROW_HEIGHT_EM = 2.25;
const MENU_ICON_CLASS_NAME = "size-3.5 shrink-0 text-muted-foreground";
const EDITED_FILE_EDITOR_ORDER: ReadonlyArray<EditorId> = [
  "file-manager",
  "vscode",
  "cursor",
  "webstorm",
  "terminal",
  "iterm",
];
export function EditedFileRow(props: EditedFileRowProps) {
  const copyPathToClipboard = useCopyPathToClipboard();
  const { absolutePath, relativePath } = resolveEditedFilePathTargets(
    props.file.path,
    props.file.workspaceRoot,
  );
  const { dir, name } = splitRepoRelativePath(relativePath ?? props.file.path);
  return (
    <div
      data-edited-file-row="true"
      className={cn(
        "font-system-ui flex w-full min-w-0 items-center gap-1.5 overflow-hidden border-t border-[color:var(--color-border-light)] bg-transparent pr-2 transition-colors hover:bg-[var(--color-background-button-secondary-hover)] dark:bg-transparent dark:hover:bg-transparent",
        props.appearance.withFirstReset && "first:border-t-0",
      )}
      style={{
        fontSize: props.appearance.fontSize,
        height: `${EDITED_FILE_ROW_HEIGHT_EM}em`,
      }}
    >
      <button
        type="button"
        aria-label={`Review changes to ${props.file.path}`}
        title={props.file.path}
        className="group/file-row flex h-full min-w-0 flex-1 items-center gap-2 bg-transparent pl-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        onClick={props.onReview}
      >
        <FileEntryIcon
          pathValue={props.file.path}
          kind="file"
          theme={props.appearance.theme}
          className="opacity-70 dark:opacity-80"
        />
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span
            className={cn(
              "min-w-0 truncate text-[var(--color-text-foreground)] underline-offset-2 group-hover/file-row:underline group-focus-visible/file-row:underline",
              props.file.kind === "deleted" && "line-through",
            )}
          >
            {name}
          </span>
          {dir ? (
            // The folder gives way before the file name does.
            <span className="min-w-0 shrink-[100] truncate text-[0.85em] text-muted-foreground/60">
              {dir.replace(/\/$/, "")}
            </span>
          ) : null}
        </span>
        {props.file.additions + props.file.deletions > 0 ? (
          <span className="ml-auto shrink-0 tabular-nums">
            <DiffStatLabel additions={props.file.additions} deletions={props.file.deletions} />
          </span>
        ) : null}
      </button>

      <OpenInPicker
        variant="compact"
        {...(props.editorConfig.keybindings
          ? {
              keybindings: props.editorConfig.keybindings,
            }
          : {})}
        {...(props.editorConfig.availableEditors
          ? {
              availableEditors: props.editorConfig.availableEditors,
            }
          : {})}
        openInTarget={props.file.kind === "deleted" ? null : absolutePath}
        menuOptions={{
          editorOrder: EDITED_FILE_EDITOR_ORDER,
          groupLabel: `Open ${props.file.path}`,
          label: `Open ${props.file.path} options`,
          additionalItems: (
            <>
              <MenuItem
                disabled={absolutePath === null}
                onClick={() => {
                  if (absolutePath) copyPathToClipboard(absolutePath);
                }}
              >
                <Copy01Icon className={MENU_ICON_CLASS_NAME} />
                <span>Copy absolute path</span>
              </MenuItem>
              <MenuItem
                disabled={relativePath === null}
                onClick={() => {
                  if (relativePath) copyPathToClipboard(relativePath);
                }}
              >
                <Copy01Icon className={MENU_ICON_CLASS_NAME} />
                <span>Copy relative path</span>
              </MenuItem>
            </>
          ),
        }}
      />
    </div>
  );
}
function resolveEditedFilePathTargets(filePath: string, workspaceRoot: string | undefined) {
  const trimmedPath = filePath.trim();
  if (trimmedPath.length === 0) {
    return {
      absolutePath: null,
      relativePath: null,
    };
  }
  if (isLocalAbsolutePath(trimmedPath)) {
    return {
      absolutePath: trimmedPath,
      relativePath: workspaceRoot ? workspaceRelativePathOf(trimmedPath, workspaceRoot) : null,
    };
  }
  if (!isWorkspaceRelativePathSafe(trimmedPath)) {
    return {
      absolutePath: null,
      relativePath: null,
    };
  }
  const relativePath = trimmedPath.replace(/\\/g, "/");
  return {
    absolutePath: workspaceRoot ? joinWorkspaceRelativePath(workspaceRoot, relativePath) : null,
    relativePath,
  };
}
