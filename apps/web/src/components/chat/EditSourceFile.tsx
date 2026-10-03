import type { FileDiffMetadata } from "@pierre/diffs";
import { useState } from "react";
import { ensureNativeApi } from "~/nativeApi";
import { resolveFileDiffPath } from "~/lib/diffRendering";
import { PencilIcon } from "~/lib/icons";
import { Button } from "../ui/button";

export function EditSourceFile(props: {
  cwd: string | null;
  file: FileDiffMetadata;
  onOpenFile: (path: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const path = resolveFileDiffPath(props.file);
  if (props.file.type === "deleted") return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={!props.cwd || opening}
      title={error ?? "Edit current file"}
      onClick={(event) => {
        event.stopPropagation();
        if (!props.cwd) return;
        setOpening(true);
        void ensureNativeApi()
          .projects.readFile({ cwd: props.cwd, relativePath: path, maxBytes: 1 })
          .then(() => {
            setError(null);
            props.onOpenFile(path);
          })
          .catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : "Current file unavailable"),
          )
          .finally(() => setOpening(false));
      }}
    >
      <PencilIcon className="size-3.5" />
      {error ? "File unavailable" : "Edit"}
    </Button>
  );
}
