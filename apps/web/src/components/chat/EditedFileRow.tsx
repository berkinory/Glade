import { Copy01Icon } from "~/lib/icons";
import type { EditorId } from "@glade/contracts/settings/editor";
import type { ResolvedKeybindingsConfig } from "@glade/contracts/settings/keybindings";
import type { CSSProperties } from "react";
import { useCopyPathToClipboard } from "~/hooks/useCopyToClipboard";
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
  return (
    <div
      data-edited-file-row="true"
      className={cn(
        "flex w-full min-w-0 items-center gap-1.5 overflow-hidden border-t border-[color:var(--color-border-light)] bg-transparent py-1.5 pr-2 transition-colors hover:bg-[var(--color-background-button-secondary-hover)] dark:bg-transparent dark:hover:bg-transparent",
        props.appearance.withFirstReset && "first:border-t-0",
      )}
    >
      <button
        type="button"
        aria-label={`Review changes to ${props.file.path}`}
        className="group/file-row flex min-w-0 flex-1 items-center gap-2 self-stretch bg-transparent py-1 pl-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        onClick={props.onReview}
      >
        <FileEntryIcon
          pathValue={props.file.path}
          kind="file"
          theme={props.appearance.theme}
          className="size-4 shrink-0 text-[var(--color-text-foreground)] opacity-70 dark:opacity-80"
        />
        <span
          className="font-system-ui min-w-0 truncate font-normal text-[var(--color-text-foreground)] underline-offset-2 group-hover/file-row:underline group-focus-visible/file-row:underline"
          style={{
            fontSize: props.appearance.fontSize,
          }}
          title={props.file.path}
        >
          {props.file.path}
        </span>
        {props.file.additions + props.file.deletions > 0 ? (
          <span
            className="font-system-ui ml-auto shrink-0 tabular-nums"
            style={{
              fontSize: props.appearance.fontSize,
            }}
          >
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
