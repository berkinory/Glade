import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer";
import {
  clampExpandedCursor,
  getAbsoluteOffsetForPoint,
  $getComposerRootLength,
  $setSelectionAtComposerOffset,
  $readSelectionOffsetFromEditorState,
  $readExpandedSelectionOffsetFromEditorState,
} from "./composerEditorSelection";
import { $setComposerEditorPrompt, collectTerminalContextIds } from "./composerEditorPrompt";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import {
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  COMMAND_PRIORITY_HIGH,
  KEY_BACKSPACE_COMMAND,
  PASTE_COMMAND,
  TextNode,
  $getRoot,
  $nodesOfType,
  type EditorState,
} from "lexical";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type ClipboardEventHandler,
  type Ref,
} from "react";

import {
  clampCollapsedComposerCursor,
  collapseExpandedComposerCursor,
  expandCollapsedComposerCursor,
  isCollapsedCursorAdjacentToInlineToken,
} from "~/composer-logic";
import { matchComposerLinkToken } from "~/composer-editor-mentions";
import { parseBareComposerLink } from "~/lib/linkChips";
import { type TerminalContextDraft } from "~/lib/terminalContext";
import { shouldCollapsePastedText } from "~/lib/composerPastedText";
import type { ProviderMentionReference } from "@glade/contracts/provider/providerDiscovery";
import { useStore } from "~/store";
import { createComposerThreadMentionSourcesSelector } from "~/storeSelectors";
import { cn } from "~/lib/utils";
import {
  COMPOSER_EDITOR_CONTENT_RESET_CLASS_NAME,
  COMPOSER_EDITOR_MIN_HEIGHT_CLASS_NAME,
  COMPOSER_PLACEHOLDER_TEXT_CLASS_NAME,
  COMPOSER_EDITOR_TYPOGRAPHY_CLASS_NAME,
} from "./chat/composerPickerStyles";
import {
  ComposerMentionNode,
  ComposerTerminalContextNode,
  $createComposerLinkNode,
  isComposerInlineTokenNode,
  COMPOSER_NODE_CLASSES,
} from "./composer-nodes";

const COMPOSER_EDITOR_HMR_KEY = `composer-editor-${Math.random().toString(36).slice(2)}`;

const ComposerRemoveTerminalContextContext = createContext<(contextId: string) => void>(() => {});

function terminalContextSignature(contexts: ReadonlyArray<TerminalContextDraft>): string {
  return contexts
    .map((context) =>
      [
        context.id,
        context.threadId,
        context.terminalId,
        context.terminalLabel,
        context.lineStart,
        context.lineEnd,
        context.createdAt,
        context.text,
      ].join("\u001f"),
    )
    .join("\u001e");
}

function mentionReferencesSignature(mentions: ReadonlyArray<ProviderMentionReference>): string {
  return mentions.map((mention) => `${mention.name}\u0000${mention.path}`).join("\u0001");
}

export interface ComposerPromptEditorHandle {
  blur: () => void;
  focus: () => void;
  focusAt: (cursor: number) => void;
  focusAtEnd: () => void;
  isFocused: () => boolean;
  readSnapshot: () => {
    value: string;
    cursor: number;
    expandedCursor: number;
    selectionCollapsed: boolean;
    terminalContextIds: string[];
  };
}

interface ComposerPromptEditorProps {
  value: string;
  cursor: number;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
  mentionReferences?: ReadonlyArray<ProviderMentionReference>;
  disabled: boolean;
  placeholder: string;
  ariaLabel?: string | undefined;
  className?: string;
  onRemoveTerminalContext: (contextId: string) => void;

  onCollapsePastedText?: (text: string) => void;
  onChange: (
    nextValue: string,
    nextCursor: number,
    expandedCursor: number,
    cursorAdjacentToMention: boolean,
    terminalContextIds: string[],
  ) => void;
  onCommandKeyDown?: (
    key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab" | "Slash",
    event: KeyboardEvent,
  ) => boolean;
  onPaste: ClipboardEventHandler<HTMLElement>;
}

interface ComposerPromptEditorInnerProps extends ComposerPromptEditorProps {
  editorRef: Ref<ComposerPromptEditorHandle>;
}

function ComposerCommandKeyPlugin(props: {
  onCommandKeyDown?: (
    key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab" | "Slash",
    event: KeyboardEvent,
  ) => boolean;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const handleCommand = (
      key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab" | "Slash",
      event: KeyboardEvent | null,
    ): boolean => {
      if (!props.onCommandKeyDown || !event) {
        return false;
      }
      const handled = props.onCommandKeyDown(key, event);
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
      return handled;
    };

    const unregisterArrowDown = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (event) => handleCommand("ArrowDown", event),
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterArrowUp = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => handleCommand("ArrowUp", event),
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => handleCommand("Enter", event),
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterTab = editor.registerCommand(
      KEY_TAB_COMMAND,
      (event) => handleCommand("Tab", event),
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterSlash = editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event) =>
        event instanceof KeyboardEvent && event.key === "/" ? handleCommand("Slash", event) : false,
      COMMAND_PRIORITY_HIGH,
    );

    return () => {
      unregisterArrowDown();
      unregisterArrowUp();
      unregisterEnter();
      unregisterTab();
      unregisterSlash();
    };
  }, [editor, props]);

  return null;
}

function ComposerInlineTokenArrowPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const unregisterLeft = editor.registerCommand(
      KEY_ARROW_LEFT_COMMAND,
      (event) => {
        let nextOffset: number | null = null;
        editor.getEditorState().read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
          const currentOffset = $readSelectionOffsetFromEditorState(0);
          if (currentOffset <= 0) return;
          const promptValue = $getRoot().getTextContent();
          if (!isCollapsedCursorAdjacentToInlineToken(promptValue, currentOffset, "left")) {
            return;
          }
          nextOffset = currentOffset - 1;
        });
        if (nextOffset === null) return false;
        const selectionOffset = nextOffset;
        event?.preventDefault();
        event?.stopPropagation();
        editor.update(() => {
          $setSelectionAtComposerOffset(selectionOffset);
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterRight = editor.registerCommand(
      KEY_ARROW_RIGHT_COMMAND,
      (event) => {
        let nextOffset: number | null = null;
        editor.getEditorState().read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
          const currentOffset = $readSelectionOffsetFromEditorState(0);
          const composerLength = $getComposerRootLength();
          if (currentOffset >= composerLength) return;
          const promptValue = $getRoot().getTextContent();
          if (!isCollapsedCursorAdjacentToInlineToken(promptValue, currentOffset, "right")) {
            return;
          }
          nextOffset = currentOffset + 1;
        });
        if (nextOffset === null) return false;
        const selectionOffset = nextOffset;
        event?.preventDefault();
        event?.stopPropagation();
        editor.update(() => {
          $setSelectionAtComposerOffset(selectionOffset);
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
    return () => {
      unregisterLeft();
      unregisterRight();
    };
  }, [editor]);

  return null;
}

function ComposerInlineTokenSelectionNormalizePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      let afterOffset: number | null = null;
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
        const anchorNode = selection.anchor.getNode();
        if (!isComposerInlineTokenNode(anchorNode)) return;
        if (selection.anchor.offset === 0) return;
        const beforeOffset = getAbsoluteOffsetForPoint(anchorNode, 0);
        afterOffset = beforeOffset + 1;
      });
      if (afterOffset !== null) {
        queueMicrotask(() => {
          editor.update(() => {
            $setSelectionAtComposerOffset(afterOffset!);
          });
        });
      }
    });
  }, [editor]);

  return null;
}

function ComposerInlineTokenBackspacePlugin() {
  const [editor] = useLexicalComposerContext();
  const onRemoveTerminalContext = useContext(ComposerRemoveTerminalContextContext);

  useEffect(() => {
    return editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return false;
        }

        const anchorNode = selection.anchor.getNode();
        const selectionOffset = $readSelectionOffsetFromEditorState(0);
        const removeInlineTokenNode = (candidate: unknown): boolean => {
          if (!isComposerInlineTokenNode(candidate)) {
            return false;
          }
          const tokenStart = getAbsoluteOffsetForPoint(candidate, 0);
          candidate.remove();
          if (candidate instanceof ComposerTerminalContextNode) {
            onRemoveTerminalContext(candidate.__context.id);
            $setSelectionAtComposerOffset(selectionOffset);
          } else {
            $setSelectionAtComposerOffset(tokenStart);
          }
          event?.preventDefault();
          return true;
        };
        if (removeInlineTokenNode(anchorNode)) {
          return true;
        }

        if ($isTextNode(anchorNode)) {
          if (selection.anchor.offset > 0) {
            return false;
          }
          if (removeInlineTokenNode(anchorNode.getPreviousSibling())) {
            return true;
          }
          const parent = anchorNode.getParent();
          if ($isElementNode(parent)) {
            const index = anchorNode.getIndexWithinParent();
            if (index > 0 && removeInlineTokenNode(parent.getChildAtIndex(index - 1))) {
              return true;
            }
          }
          return false;
        }

        if ($isElementNode(anchorNode)) {
          const childIndex = selection.anchor.offset - 1;
          if (childIndex >= 0 && removeInlineTokenNode(anchorNode.getChildAtIndex(childIndex))) {
            return true;
          }
        }

        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, onRemoveTerminalContext]);

  return null;
}

// The controlled value→editor sync never re-tokenizes user input (the editor text already equals
// the prompt string, so the rewrite is skipped), so live chipping must run as a node transform. A
// chip's text content is the raw URL, so the serialized prompt is unchanged and selection/length
// stay stable.
function ComposerLinkTransformPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerNodeTransform(TextNode, (node) => {
      if (isComposerInlineTokenNode(node)) {
        return;
      }
      const match = matchComposerLinkToken(node.getTextContent(), {
        includeTrailingTokenAtEnd: false,
      });
      if (!match) {
        return;
      }
      const splitNodes = node.splitText(match.start, match.end);
      const urlNode = match.start === 0 ? splitNodes[0] : splitNodes[1];
      urlNode?.replace($createComposerLinkNode(match.url));
    });
  }, [editor]);

  return null;
}

function ComposerLinkPastePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        const clipboardData = event instanceof ClipboardEvent ? event.clipboardData : null;
        const url = parseBareComposerLink(clipboardData?.getData("text/plain") ?? "");
        if (!url) {
          return false;
        }

        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return false;
        }
        event.preventDefault();
        selection.insertNodes([$createComposerLinkNode(url)]);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  return null;
}

// Refresh the stored provider on existing chips whenever the summaries change so the icon never
// stays stale.
function ComposerThreadMentionProviderPlugin() {
  const [editor] = useLexicalComposerContext();
  const threadMentionSources = useStore(
    useMemo(() => createComposerThreadMentionSourcesSelector(), []),
  );
  const providerByThreadId = useMemo(
    () => new Map(threadMentionSources.map((source) => [source.id as string, source.provider])),
    [threadMentionSources],
  );

  useEffect(() => {
    const staleProvider = (node: ComposerMentionNode): boolean => {
      const threadId = node.getMentionThreadId();
      if (!threadId) return false;
      const provider = providerByThreadId.get(threadId);
      return provider !== undefined && provider !== node.getMentionProvider();
    };
    const needsUpdate = editor
      .getEditorState()
      .read(() => $nodesOfType(ComposerMentionNode).some(staleProvider));
    if (!needsUpdate) return;
    editor.update(
      () => {
        for (const node of $nodesOfType(ComposerMentionNode)) {
          if (!staleProvider(node)) continue;
          const provider = providerByThreadId.get(node.getMentionThreadId() ?? "");
          if (provider) node.setMentionProvider(provider);
        }
      },
      { tag: "history-merge" },
    );
  }, [editor, providerByThreadId]);

  return null;
}

// Intercepting at the Lexical command level (rather than the React onPaste prop) is required:
// Lexical's own paste listener would otherwise insert the raw text before a bubbled React handler
// could preventDefault.
function ComposerBigPastePlugin(props: { onCollapsePastedText: (text: string) => void }) {
  const [editor] = useLexicalComposerContext();
  const onCollapseRef = useRef(props.onCollapsePastedText);

  useEffect(() => {
    onCollapseRef.current = props.onCollapsePastedText;
  }, [props.onCollapsePastedText]);

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        const clipboardData = event instanceof ClipboardEvent ? event.clipboardData : null;
        if (!clipboardData) {
          return false;
        }

        if (clipboardData.files.length > 0) {
          return false;
        }
        const text = clipboardData.getData("text/plain");
        if (!shouldCollapsePastedText(text)) {
          return false;
        }
        event.preventDefault();
        onCollapseRef.current(text);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  return null;
}

function ComposerPromptEditorInner({
  value,
  cursor,
  terminalContexts,
  mentionReferences: mentionReferencesProp,
  disabled,
  placeholder,
  ariaLabel,
  className,
  onRemoveTerminalContext,
  onCollapsePastedText,
  onChange,
  onCommandKeyDown,
  onPaste,
  editorRef,
}: ComposerPromptEditorInnerProps) {
  const mentionReferences = useMemo(() => mentionReferencesProp ?? [], [mentionReferencesProp]);
  const [editor] = useLexicalComposerContext();
  const onChangeRef = useRef(onChange);
  const initialCursor = clampCollapsedComposerCursor(value, cursor);
  const terminalContextsSignature = terminalContextSignature(terminalContexts);
  const terminalContextsSignatureRef = useRef(terminalContextsSignature);
  const mentionsSignature = mentionReferencesSignature(mentionReferences);
  const mentionsSignatureRef = useRef(mentionsSignature);
  const snapshotRef = useRef({
    value,
    cursor: initialCursor,
    expandedCursor: expandCollapsedComposerCursor(value, initialCursor),
    selectionCollapsed: true,
    terminalContextIds: terminalContexts.map((context) => context.id),
  });
  const isApplyingControlledUpdateRef = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Remember whether the composer owned focus at disable time and hand it back once re-enabled, so
  // sending a message never silently kicks the user out of the input.
  const restoreFocusOnEnableRef = useRef(false);
  useEffect(() => {
    if (disabled) {
      const rootElement = editor.getRootElement();
      restoreFocusOnEnableRef.current = Boolean(
        rootElement && document.activeElement === rootElement,
      );
      editor.setEditable(false);
      return;
    }
    editor.setEditable(true);
    if (restoreFocusOnEnableRef.current) {
      restoreFocusOnEnableRef.current = false;
      editor.getRootElement()?.focus();
    }
  }, [disabled, editor]);

  useLayoutEffect(() => {
    const normalizedCursor = clampCollapsedComposerCursor(value, cursor);
    const previousSnapshot = snapshotRef.current;
    const contextsChanged = terminalContextsSignatureRef.current !== terminalContextsSignature;
    const mentionsChanged = mentionsSignatureRef.current !== mentionsSignature;
    if (
      previousSnapshot.value === value &&
      previousSnapshot.cursor === normalizedCursor &&
      !contextsChanged &&
      !mentionsChanged
    ) {
      return;
    }

    snapshotRef.current = {
      value,
      cursor: normalizedCursor,
      expandedCursor: expandCollapsedComposerCursor(value, normalizedCursor),
      selectionCollapsed: true,
      terminalContextIds: terminalContexts.map((context) => context.id),
    };
    terminalContextsSignatureRef.current = terminalContextsSignature;
    mentionsSignatureRef.current = mentionsSignature;

    const rootElement = editor.getRootElement();
    const isFocused = Boolean(rootElement && document.activeElement === rootElement);
    if (previousSnapshot.value === value && !contextsChanged && !mentionsChanged && !isFocused) {
      return;
    }

    isApplyingControlledUpdateRef.current = true;
    // Commit controlled draft changes before paint so a thread switch cannot show the old height.
    editor.update(
      () => {
        const shouldRewriteEditorState =
          previousSnapshot.value !== value || contextsChanged || mentionsChanged;
        if (shouldRewriteEditorState) {
          $setComposerEditorPrompt(value, terminalContexts, mentionReferences);
        }
        if (shouldRewriteEditorState || isFocused) {
          $setSelectionAtComposerOffset(normalizedCursor);
        }
      },
      { discrete: true },
    );
    queueMicrotask(() => {
      isApplyingControlledUpdateRef.current = false;
    });
  }, [
    cursor,
    editor,
    mentionReferences,
    mentionsSignature,
    terminalContexts,
    terminalContextsSignature,
    value,
  ]);

  const focusAt = useCallback(
    (nextCursor: number) => {
      const rootElement = editor.getRootElement();
      if (!rootElement) return;
      const boundedCursor = clampCollapsedComposerCursor(snapshotRef.current.value, nextCursor);
      rootElement.focus();
      editor.update(() => {
        $setSelectionAtComposerOffset(boundedCursor);
      });
      snapshotRef.current = {
        value: snapshotRef.current.value,
        cursor: boundedCursor,
        expandedCursor: expandCollapsedComposerCursor(snapshotRef.current.value, boundedCursor),
        selectionCollapsed: true,
        terminalContextIds: snapshotRef.current.terminalContextIds,
      };
      onChangeRef.current(
        snapshotRef.current.value,
        boundedCursor,
        snapshotRef.current.expandedCursor,
        false,
        snapshotRef.current.terminalContextIds,
      );
    },
    [editor],
  );

  const blurEditor = useCallback(() => {
    editor.getRootElement()?.blur();
  }, [editor]);

  const isEditorFocused = useCallback(() => {
    const rootElement = editor.getRootElement();
    return Boolean(
      rootElement && typeof document !== "undefined" && document.activeElement === rootElement,
    );
  }, [editor]);

  const readSnapshot = useCallback((): {
    value: string;
    cursor: number;
    expandedCursor: number;
    selectionCollapsed: boolean;
    terminalContextIds: string[];
  } => {
    let snapshot = snapshotRef.current;
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      const selectionCollapsed = !$isRangeSelection(selection) || selection.isCollapsed();
      const nextValue = $getRoot().getTextContent();
      const fallbackCursor = clampCollapsedComposerCursor(nextValue, snapshotRef.current.cursor);
      const nextCursor = clampCollapsedComposerCursor(
        nextValue,
        $readSelectionOffsetFromEditorState(fallbackCursor),
      );
      const fallbackExpandedCursor = clampExpandedCursor(
        nextValue,
        snapshotRef.current.expandedCursor,
      );
      const nextExpandedCursor = clampExpandedCursor(
        nextValue,
        $readExpandedSelectionOffsetFromEditorState(fallbackExpandedCursor),
      );
      const terminalContextIds = collectTerminalContextIds($getRoot());
      snapshot = {
        value: nextValue,
        cursor: nextCursor,
        expandedCursor: nextExpandedCursor,
        selectionCollapsed,
        terminalContextIds,
      };
    });
    snapshotRef.current = snapshot;
    return snapshot;
  }, [editor]);

  useImperativeHandle(
    editorRef,
    () => ({
      blur: blurEditor,
      focus: () => {
        focusAt(snapshotRef.current.cursor);
      },
      focusAt,
      focusAtEnd: () => {
        focusAt(
          collapseExpandedComposerCursor(
            snapshotRef.current.value,
            snapshotRef.current.value.length,
          ),
        );
      },
      isFocused: isEditorFocused,
      readSnapshot,
    }),
    [blurEditor, focusAt, isEditorFocused, readSnapshot],
  );

  const handleEditorChange = useCallback((editorState: EditorState) => {
    editorState.read(() => {
      const selection = $getSelection();
      const selectionCollapsed = !$isRangeSelection(selection) || selection.isCollapsed();
      const nextValue = $getRoot().getTextContent();
      const fallbackCursor = clampCollapsedComposerCursor(nextValue, snapshotRef.current.cursor);
      const nextCursor = clampCollapsedComposerCursor(
        nextValue,
        $readSelectionOffsetFromEditorState(fallbackCursor),
      );
      const fallbackExpandedCursor = clampExpandedCursor(
        nextValue,
        snapshotRef.current.expandedCursor,
      );
      const nextExpandedCursor = clampExpandedCursor(
        nextValue,
        $readExpandedSelectionOffsetFromEditorState(fallbackExpandedCursor),
      );
      const terminalContextIds = collectTerminalContextIds($getRoot());
      const previousSnapshot = snapshotRef.current;
      if (
        previousSnapshot.value === nextValue &&
        previousSnapshot.cursor === nextCursor &&
        previousSnapshot.expandedCursor === nextExpandedCursor &&
        previousSnapshot.terminalContextIds.length === terminalContextIds.length &&
        previousSnapshot.terminalContextIds.every((id, index) => id === terminalContextIds[index])
      ) {
        return;
      }
      if (isApplyingControlledUpdateRef.current) {
        return;
      }
      snapshotRef.current = {
        value: nextValue,
        cursor: nextCursor,
        expandedCursor: nextExpandedCursor,
        selectionCollapsed,
        terminalContextIds,
      };
      const cursorAdjacentToMention =
        isCollapsedCursorAdjacentToInlineToken(nextValue, nextCursor, "left") ||
        isCollapsedCursorAdjacentToInlineToken(nextValue, nextCursor, "right");
      onChangeRef.current(
        nextValue,
        nextCursor,
        nextExpandedCursor,
        cursorAdjacentToMention,
        terminalContextIds,
      );
    });
  }, []);

  return (
    <ComposerRemoveTerminalContextContext.Provider value={onRemoveTerminalContext}>
      <div className="relative">
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              className={cn(
                "block max-h-[200px] w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent text-foreground focus:outline-none",
                COMPOSER_EDITOR_TYPOGRAPHY_CLASS_NAME,
                COMPOSER_EDITOR_MIN_HEIGHT_CLASS_NAME,
                COMPOSER_EDITOR_CONTENT_RESET_CLASS_NAME,
                className,
              )}
              data-testid="composer-editor"
              aria-placeholder={placeholder}
              aria-label={ariaLabel}
              placeholder={<span />}
              onPaste={onPaste}
            />
          }
          placeholder={
            terminalContexts.length > 0 ? null : (
              <div
                className={cn(
                  "pointer-events-none absolute inset-0",
                  COMPOSER_PLACEHOLDER_TEXT_CLASS_NAME,
                  COMPOSER_EDITOR_TYPOGRAPHY_CLASS_NAME,
                )}
              >
                {placeholder}
              </div>
            )
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <OnChangePlugin onChange={handleEditorChange} />
        <ComposerCommandKeyPlugin {...(onCommandKeyDown ? { onCommandKeyDown } : {})} />
        <ComposerInlineTokenArrowPlugin />
        <ComposerInlineTokenSelectionNormalizePlugin />
        <ComposerInlineTokenBackspacePlugin />
        <ComposerLinkTransformPlugin />
        <ComposerLinkPastePlugin />
        <ComposerThreadMentionProviderPlugin />
        {onCollapsePastedText ? (
          <ComposerBigPastePlugin onCollapsePastedText={onCollapsePastedText} />
        ) : null}
        <HistoryPlugin />
      </div>
    </ComposerRemoveTerminalContextContext.Provider>
  );
}

export const ComposerPromptEditor = forwardRef<
  ComposerPromptEditorHandle,
  ComposerPromptEditorProps
>(function ComposerPromptEditor(
  {
    value,
    cursor,
    terminalContexts,
    mentionReferences,
    disabled,
    placeholder,
    ariaLabel,
    className,
    onRemoveTerminalContext,
    onCollapsePastedText,
    onChange,
    onCommandKeyDown,
    onPaste,
  },
  ref,
) {
  const initialValueRef = useRef(value);
  const initialTerminalContextsRef = useRef(terminalContexts);

  const normalizedMentionReferences = mentionReferences ?? [];
  const initialMentionReferencesRef = useRef(normalizedMentionReferences);
  const initialConfig: InitialConfigType = {
    namespace: "glade-composer-editor",
    editable: true,
    nodes: [...COMPOSER_NODE_CLASSES],
    editorState: () => {
      $setComposerEditorPrompt(
        initialValueRef.current,
        initialTerminalContextsRef.current,
        initialMentionReferencesRef.current,
      );
    },
    onError: (error) => {
      throw error;
    },
  };

  return (
    <LexicalComposer key={COMPOSER_EDITOR_HMR_KEY} initialConfig={initialConfig}>
      <ComposerPromptEditorInner
        value={value}
        cursor={cursor}
        terminalContexts={terminalContexts}
        mentionReferences={normalizedMentionReferences}
        disabled={disabled}
        placeholder={placeholder}
        ariaLabel={ariaLabel}
        onRemoveTerminalContext={onRemoveTerminalContext}
        onChange={onChange}
        onPaste={onPaste}
        editorRef={ref}
        {...(onCollapsePastedText ? { onCollapsePastedText } : {})}
        {...(onCommandKeyDown ? { onCommandKeyDown } : {})}
        {...(className ? { className } : {})}
      />
    </LexicalComposer>
  );
});
