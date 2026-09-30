import { isLocalAbsolutePath } from "@glade/shared/platform/path";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { showFileReferenceContextMenu } from "../lib/fileReferenceContextMenu";
import { openWorkspaceFileReference, useWorkspaceFileOpener } from "../lib/workspaceFileOpener";
import { projectResolveWorkspaceFileReferenceQueryOptions } from "../lib/projectReactQuery";
import { InlineMentionChip } from "./chat/InlineMentionChip";

export const MARKDOWN_LINK_POSITION_SUFFIX_PATTERN = /:\d+(?::\d+)?$/;

export function VerifiedWorkspaceFileChip(props: {
  rawReference: string;
  cwd: string;
  theme: "light" | "dark";
  label?: ReactNode;
  href?: string;
}) {
  const relativePath = props.rawReference.replace(MARKDOWN_LINK_POSITION_SUFFIX_PATTERN, "");
  const query = useQuery(
    projectResolveWorkspaceFileReferenceQueryOptions({
      cwd: props.cwd,
      relativePath,
    }),
  );
  const fallback = <code>{props.label ?? relativePath}</code>;
  if (query.isPending || query.isError || query.data === undefined) {
    return fallback;
  }
  if (query.data === null) {
    return fallback;
  }
  return (
    <OpenableFileChip
      targetPath={query.data}
      theme={props.theme}
      {...(props.label !== undefined ? { label: props.label } : {})}
      {...(props.href ? { href: props.href } : {})}
    />
  );
}

export function OpenableFileChip(props: {
  targetPath: string;
  theme: "light" | "dark";
  label?: ReactNode;
  href?: string;
}) {
  const opener = useWorkspaceFileOpener();
  const chipPath = props.targetPath.replace(MARKDOWN_LINK_POSITION_SUFFIX_PATTERN, "");
  const revealPath = isLocalAbsolutePath(chipPath) ? chipPath : undefined;
  return (
    <InlineMentionChip
      path={chipPath}
      theme={props.theme}
      href={props.href ?? props.targetPath}
      onActivate={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const forceExternalEditor = event.metaKey || event.ctrlKey;
        openWorkspaceFileReference(forceExternalEditor ? null : opener, props.targetPath);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void showFileReferenceContextMenu({
          path: chipPath,
          ...(revealPath ? { revealPath } : {}),
          position: { x: event.clientX, y: event.clientY },
          onReferenceInChat: undefined,
        });
      }}
      {...(opener?.prefetchFile
        ? { onHoverPrefetch: () => opener.prefetchFile?.(props.targetPath) }
        : {})}
      {...(props.label !== undefined ? { label: props.label } : {})}
    />
  );
}
