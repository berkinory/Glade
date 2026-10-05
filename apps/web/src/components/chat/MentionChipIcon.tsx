import { MessageCircleIcon, PuzzleIcon } from "~/lib/icons";
import { getFileIconUrl, getFolderIconUrl, inferEntryKindFromPath } from "~/file-icons";
import {
  findThreadProviderMentionReferenceForToken,
  resolveMentionChipKind,
  threadIdFromProviderMentionReference,
  type MentionChipKind,
} from "~/lib/composerMentions";
import { createIconElement } from "~/lib/createIconElement";
import { COMPOSER_INLINE_CHIP_INLINE_ICON_CLASS_NAME } from "../composerInlineChip";
import { FileEntryIcon } from "./FileEntryIcon";
import type { ProviderMentionReference } from "@glade/contracts/provider/providerDiscovery";
import { threadIdFromThreadMentionPath } from "@glade/shared/threads/threadMentions";
import { useStore } from "~/store";
import { resolveThreadDisplayProvider } from "~/lib/threadDisplayProvider";
import { ProviderIcon } from "../ProviderIcon";
export type { MentionChipKind };
export const MentionChipIcon = function MentionChipIcon(props: {
  path: string;
  theme: "light" | "dark";
  kind?: MentionChipKind;
  mentionReferences?: ReadonlyArray<ProviderMentionReference>;
  className?: string;
}) {
  const className = props.className ?? COMPOSER_INLINE_CHIP_INLINE_ICON_CLASS_NAME;
  const resolvedKind = resolveMentionChipKind(props.path, {
    ...(props.kind
      ? {
          kind: props.kind,
        }
      : {}),
    ...(props.mentionReferences
      ? {
          mentionReferences: props.mentionReferences,
        }
      : {}),
  });
  const threadMention = findThreadProviderMentionReferenceForToken(
    props.path,
    props.mentionReferences,
  );
  const threadId = threadMention
    ? threadIdFromProviderMentionReference(threadMention)
    : threadIdFromThreadMentionPath(props.path);
  const threadProvider = useStore((state) => {
    if (!threadId) return null;
    const thread = state.sidebarThreadSummaryById[threadId];
    return thread ? resolveThreadDisplayProvider(thread) : null;
  });
  if (resolvedKind === "thread") {
    return (
      <ProviderIcon
        provider={threadProvider}
        className={className}
        fallback={<MessageCircleIcon className={className} />}
      />
    );
  }
  if (resolvedKind === "plugin") {
    return <PuzzleIcon className={className} />;
  }
  return (
    <FileEntryIcon
      pathValue={props.path}
      kind={inferEntryKindFromPath(props.path)}
      className={className}
    />
  );
};
export function createMentionChipIconElement(
  path: string,
  kind: MentionChipKind = "path",
  className: string = COMPOSER_INLINE_CHIP_INLINE_ICON_CLASS_NAME,
): HTMLElement | SVGSVGElement {
  if (kind === "plugin" || path.startsWith("plugin://")) {
    return createIconElement(PuzzleIcon, className);
  }
  const icon = document.createElement("img");
  icon.src =
    inferEntryKindFromPath(path) === "directory" ? getFolderIconUrl(path) : getFileIconUrl(path);
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  icon.className = className;
  return icon;
}
