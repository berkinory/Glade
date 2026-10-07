import type { ProviderMentionReference } from "@glade/contracts/provider/providerDiscovery";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  type ElementNode,
  type LexicalNode,
} from "lexical";
import { splitPromptIntoComposerSegments } from "~/composer-editor-mentions";
import type { TerminalContextDraft } from "~/lib/terminalContext";
import { resolveThreadDisplayProvider } from "~/lib/threadDisplayProvider";
import { useStore } from "~/store";
import {
  ComposerTerminalContextNode,
  $createComposerMentionNode,
  $createComposerSkillNode,
  $createComposerAgentMentionNode,
  $createComposerTerminalContextNode,
  $createComposerLinkNode,
  $createComposerBrowserElementNode,
} from "./composer-nodes";

function $appendTextWithLineBreaks(parent: ElementNode, text: string): void {
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.length > 0) {
      parent.append($createTextNode(line));
    }
    if (index < lines.length - 1) {
      parent.append($createLineBreakNode());
    }
  }
}

export function $setComposerEditorPrompt(
  prompt: string,
  terminalContexts: ReadonlyArray<TerminalContextDraft>,
  mentionReferences: ReadonlyArray<ProviderMentionReference> = [],
): void {
  const root = $getRoot();
  root.clear();
  const paragraph = $createParagraphNode();
  root.append(paragraph);

  const segments = splitPromptIntoComposerSegments(prompt, terminalContexts, mentionReferences);
  for (const segment of segments) {
    if (segment.type === "mention") {
      const thread = segment.threadId
        ? useStore.getState().sidebarThreadSummaryById[segment.threadId]
        : undefined;
      const provider = thread ? resolveThreadDisplayProvider(thread) : undefined;
      paragraph.append(
        $createComposerMentionNode(segment.path, segment.kind, provider, segment.threadId),
      );
      continue;
    }
    if (segment.type === "skill") {
      const prefixedName = `${segment.prefix ?? "$"}${segment.name}`;
      paragraph.append($createComposerSkillNode(prefixedName));
      continue;
    }
    if (segment.type === "terminal-context") {
      if (segment.context) {
        paragraph.append($createComposerTerminalContextNode(segment.context));
      }
      continue;
    }
    if (segment.type === "agent-mention") {
      paragraph.append($createComposerAgentMentionNode(segment.alias, segment.color));
      continue;
    }
    if (segment.type === "link") {
      paragraph.append($createComposerLinkNode(segment.url));
      continue;
    }
    if (segment.type === "browser-element") {
      paragraph.append($createComposerBrowserElementNode(segment.token, segment.reference));
      continue;
    }
    $appendTextWithLineBreaks(paragraph, segment.text);
  }
}

export function collectTerminalContextIds(node: LexicalNode): string[] {
  if (node instanceof ComposerTerminalContextNode) {
    return [node.__context.id];
  }
  if ($isElementNode(node)) {
    return node.getChildren().flatMap((child) => collectTerminalContextIds(child));
  }
  return [];
}
