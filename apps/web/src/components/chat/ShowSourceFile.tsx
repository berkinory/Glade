import { useQuery } from "@tanstack/react-query";
import type { FileDiffMetadata } from "@pierre/diffs";
import { useState } from "react";
import { ensureNativeApi } from "~/nativeApi";
import { resolveFileDiffPath } from "~/lib/diffRendering";
import { Button } from "../ui/button";

export function ShowSourceFile(props: {
  cwd: string | null;
  file: FileDiffMetadata;
  onOpenFile: (path: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const path = resolveFileDiffPath(props.file);
  const deleted = props.file.type === "deleted";
  const currentFile = useQuery({
    queryKey: ["projects", "source-file-exists", props.cwd, path],
    queryFn: () =>
      ensureNativeApi().projects.readFile({ cwd: props.cwd!, relativePath: path, maxBytes: 1 }),
    enabled: Boolean(props.cwd) && deleted,
    retry: false,
  });
  const unavailable = deleted && !currentFile.isSuccess;
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={!props.cwd || opening || (deleted && currentFile.isPending)}
      title={
        error ??
        (unavailable
          ? "Deleted file is unavailable in the working tree"
          : "Open current file in Explorer")
      }
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
      {unavailable || error ? "File unavailable" : "Show file"}
    </Button>
  );
}
