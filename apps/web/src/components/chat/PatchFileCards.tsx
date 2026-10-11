import type { FileDiffMetadata } from "@pierre/diffs/react";
import { ChevronDownIcon } from "~/lib/icons";
import { useState, type ReactNode } from "react";
import { useTheme } from "~/hooks/useTheme";
import { resolveFileDiffPath } from "~/lib/diffRendering";
import { cn } from "~/lib/utils";
import { EditSourceFile } from "./EditSourceFile";
import { FileDiffCard } from "./FileDiffView";

export function PatchFileCards(props: {
  cwd: string;
  keyPrefix: string;
  files: ReadonlyArray<FileDiffMetadata>;
  /** Shows only this file, expanded. */
  filePath?: string | undefined;
  onSelectFile?: ((path: string, preview: boolean) => void) | undefined;
  /** Offers editing the working-tree file; off when the patch is not from this checkout. */
  editable?: boolean;
  diffStyle?: "unified" | "split";
  onOpenFile: (path: string) => void;
  renderBelow?: (path: string) => ReactNode;
}) {
  const { resolvedTheme } = useTheme();
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set());
  return props.files
    .filter((file) => !props.filePath || resolveFileDiffPath(file) === props.filePath)
    .map((file) => {
      const path = resolveFileDiffPath(file);
      const expanded = Boolean(props.filePath) || expandedPaths.has(path);
      return (
        <div
          key={`${props.keyPrefix}:${path}`}
          className="diff-render-file mb-2 rounded-md"
          onClickCapture={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest("button") || !target.closest("[data-diff-file-header]")) return;
            if (props.onSelectFile) {
              props.onSelectFile(path, event.detail !== 2);
              return;
            }
            setExpandedPaths((current) => {
              const next = new Set(current);
              if (next.has(path)) next.delete(path);
              else next.add(path);
              return next;
            });
          }}
        >
          <FileDiffCard
            fileDiff={file}
            {...(props.diffStyle ? { diffStyle: props.diffStyle } : {})}
            theme={resolvedTheme as "light" | "dark"}
            collapsed={!expanded}
            renderHeaderTrailing={() => (
              <>
                {!props.onSelectFile && props.editable !== false ? (
                  <EditSourceFile cwd={props.cwd} file={file} onOpenFile={props.onOpenFile} />
                ) : null}
                <ChevronDownIcon
                  className={cn(
                    "size-3.5 text-muted-foreground transition-transform",
                    expanded && "rotate-180",
                  )}
                />
              </>
            )}
          />
          {expanded ? props.renderBelow?.(path) : null}
        </div>
      );
    });
}
