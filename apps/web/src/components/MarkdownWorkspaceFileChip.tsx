import { isLocalAbsolutePath } from "@glade/shared/platform/path";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { showFileReferenceContextMenu } from "../lib/fileReferenceContextMenu";
import { openWorkspaceFileReference, useWorkspaceFileOpener } from "../lib/workspaceFileOpener";
import {
  projectResolveWorkspaceFileReferenceQueryOptions,
  projectStatLocalPathQueryOptions,
} from "../lib/projectReactQuery";
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

// A path outside the workspace, such as `~/.zshrc` or `/tmp/run.log`, becomes a chip once the
// server finds it, with the icon of what it is. A folder is named but does not open.
export function VerifiedLocalPathChip(props: {
  reference: string;
  theme: "light" | "dark";
  label?: ReactNode;
}) {
  const position = MARKDOWN_LINK_POSITION_SUFFIX_PATTERN.exec(props.reference)?.[0] ?? "";
  const query = useQuery(
    projectStatLocalPathQueryOptions(
      props.reference.slice(0, props.reference.length - position.length),
    ),
  );
  const entry = query.data;
  if (!entry) return <code>{props.label ?? props.reference}</code>;
  if (entry.kind === "directory") {
    return (
      <InlineMentionChip
        path={entry.path}
        theme={props.theme}
        entryKind="directory"
        {...(props.label !== undefined ? { label: props.label } : {})}
      />
    );
  }
  return (
    <OpenableFileChip
      targetPath={`${entry.path}${position}`}
      theme={props.theme}
      entryKind="file"
      {...(props.label !== undefined ? { label: props.label } : {})}
    />
  );
}

export function OpenableFileChip(props: {
  targetPath: string;
  theme: "light" | "dark";
  entryKind?: "file" | "directory";
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
      entryKind={props.entryKind}
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
