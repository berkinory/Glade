import { type MouseEvent, type ReactNode } from "react";
import type { ProviderMentionReference } from "@glade/contracts/provider/providerDiscovery";
import { basenameOfPath, pathLooksLikeKnownFile } from "~/file-icons";
import { openWorkspaceFileReference, useWorkspaceFileOpener } from "~/lib/workspaceFileOpener";
import {
  COMPOSER_EDITOR_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_MENTION_CHIP_INTERACTIVE_CLASS_NAME,
} from "../composerInlineChip";
import { InlineChipContent } from "../InlineChip";
import { MentionChipIcon, type MentionChipKind } from "./MentionChipIcon";
import { resolveMentionChipKind } from "~/lib/composerMentions";

interface InlineMentionChipProps {
  path: string;
  theme: "light" | "dark";
  kind?: MentionChipKind;
  mentionReferences?: ReadonlyArray<ProviderMentionReference>;

  label?: ReactNode;

  href?: string;
  onActivate?: (event: MouseEvent<HTMLAnchorElement>) => void;
  onContextMenu?: (event: MouseEvent<HTMLAnchorElement>) => void;

  onHoverPrefetch?: (() => void) | undefined;
}

export function InlineMentionChip(props: InlineMentionChipProps) {
  const opener = useWorkspaceFileOpener();
  const resolvedKind = resolveMentionChipKind(props.path, {
    ...(props.kind ? { kind: props.kind } : {}),
    ...(props.mentionReferences ? { mentionReferences: props.mentionReferences } : {}),
  });
  const label =
    props.label ?? (resolvedKind === "thread" ? props.path : basenameOfPath(props.path));
  const inner = (
    <InlineChipContent
      icon={
        <MentionChipIcon
          path={props.path}
          theme={props.theme}
          {...(props.kind ? { kind: props.kind } : {})}
          {...(props.mentionReferences ? { mentionReferences: props.mentionReferences } : {})}
        />
      }
      label={label}
    />
  );

  const contextOpenable =
    props.href === undefined &&
    props.onActivate === undefined &&
    opener !== null &&
    (props.kind === undefined || props.kind === "path") &&
    pathLooksLikeKnownFile(props.path);

  if (props.href !== undefined || props.onActivate || contextOpenable) {
    const href = props.href ?? (contextOpenable ? props.path : undefined);
    const handleActivate =
      props.onActivate ??
      (contextOpenable
        ? (event: MouseEvent<HTMLAnchorElement>) => {
            event.preventDefault();
            event.stopPropagation();
            openWorkspaceFileReference(opener, props.path);
          }
        : undefined);
    const handleHoverPrefetch =
      props.onHoverPrefetch ??
      (contextOpenable && opener?.prefetchFile
        ? () => opener.prefetchFile?.(props.path)
        : undefined);
    return (
      <a
        className={COMPOSER_INLINE_MENTION_CHIP_INTERACTIVE_CLASS_NAME}
        title={props.path}
        {...(href !== undefined ? { href } : {})}
        {...(handleActivate ? { onClick: handleActivate } : {})}
        {...(props.onContextMenu ? { onContextMenu: props.onContextMenu } : {})}
        {...(handleHoverPrefetch
          ? { onPointerEnter: handleHoverPrefetch, onFocus: handleHoverPrefetch }
          : {})}
      >
        {inner}
      </a>
    );
  }

  return (
    <span className={COMPOSER_EDITOR_INLINE_CHIP_CLASS_NAME} title={props.path}>
      {inner}
    </span>
  );
}
