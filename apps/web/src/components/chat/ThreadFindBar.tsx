import { ArrowDown02Icon, ArrowUp02Icon, SearchIcon, XIcon } from "~/lib/icons";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { IconButton } from "~/components/ui/icon-button";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { cn } from "~/lib/utils";
import { MUTED_LABEL_TEXT_CLASS_NAME } from "~/surfaceStyles";
import type { TimelineEntry } from "../../workLog.types";
import {
  collectThreadFindDocuments,
  createThreadFindDocumentTextCache,
  findThreadMatches,
  normalizeFindQuery,
  resolveThreadFindJump,
  stepThreadFindIndex,
  type ThreadFindHighlight,
  type ThreadFindMatch,
} from "./threadFind.logic";
interface ThreadFindBarProps {
  open: boolean;
  focusNonce: number;
  timelineEntries: readonly TimelineEntry[];
  onClose: () => void;
  onJump: (match: ThreadFindMatch) => void;
  onHighlightChange: (highlight: ThreadFindHighlight | null) => void;
  onActiveMatchChange: (match: ThreadFindMatch | null) => void;
}
const FIND_QUERY_MAX_LENGTH = 200;
const FIND_STEP_BUTTON_CLASS_NAME =
  "size-7 rounded-md border-transparent bg-transparent text-muted-foreground shadow-none hover:bg-muted-foreground/15 hover:text-foreground sm:size-7";
function ThreadFindBar({
  open,
  focusNonce,
  timelineEntries,
  onClose,
  onJump,
  onHighlightChange,
  onActiveMatchChange,
}: ThreadFindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const matchesRef = useRef<ThreadFindMatch[]>([]);
  const activeIndexRef = useRef(0);
  const activeMatchRef = useRef<ThreadFindMatch | null>(null);
  const activeQueryRef = useRef("");
  const jumpFrameRef = useRef<number | null>(null);
  const onJumpRef = useRef(onJump);
  const onHighlightChangeRef = useRef(onHighlightChange);
  const onActiveMatchChangeRef = useRef(onActiveMatchChange);
  onJumpRef.current = onJump;
  onHighlightChangeRef.current = onHighlightChange;
  onActiveMatchChangeRef.current = onActiveMatchChange;
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [activeIndex, setActiveIndex] = useState(0);
  const [documentTextCache] = useState(createThreadFindDocumentTextCache);
  const documents = useMemo(
    () => (open ? collectThreadFindDocuments(timelineEntries, documentTextCache) : []),
    [documentTextCache, open, timelineEntries],
  );
  const matches = useMemo(
    () => findThreadMatches(documents, deferredQuery),
    [deferredQuery, documents],
  );
  matchesRef.current = matches;
  const matchCount = matches.length;
  const safeIndex = matchCount === 0 ? -1 : Math.min(Math.max(activeIndex, 0), matchCount - 1);
  const hasQuery = normalizeFindQuery(deferredQuery).length > 0;
  useEffect(() => {
    if (!open) {
      onHighlightChangeRef.current(null);
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const queryChanged = activeQueryRef.current !== deferredQuery;
    const previous = queryChanged ? null : activeMatchRef.current;
    const previousIndex = previous
      ? matches.findIndex(
          (match) =>
            match.messageId === previous.messageId &&
            match.segmentIndex === previous.segmentIndex &&
            match.startOffset === previous.startOffset &&
            match.endOffset === previous.endOffset,
        )
      : -1;
    const nextIndex = previousIndex >= 0 ? previousIndex : matches.length ? 0 : -1;
    const match = resolveThreadFindJump(matches, nextIndex);
    activeIndexRef.current = nextIndex;
    activeQueryRef.current = deferredQuery;
    activeMatchRef.current = match;
    setActiveIndex(nextIndex);
    onHighlightChangeRef.current({
      query: deferredQuery,
      activeMatch: match,
    });
    onActiveMatchChangeRef.current(match);
    if (match && (queryChanged || previous === null)) {
      if (jumpFrameRef.current !== null) window.cancelAnimationFrame(jumpFrameRef.current);
      // Newly fetched matches commit before the timeline refreshes its imperative row lookup.
      jumpFrameRef.current = window.requestAnimationFrame(() => {
        jumpFrameRef.current = null;
        onJumpRef.current(match);
      });
    }
  }, [deferredQuery, matches, open]);
  useEffect(() => {
    if (!open) {
      return;
    }
    const input = inputRef.current;
    if (!input) {
      return;
    }
    if (document.activeElement !== input && input.value.trim().length === 0) {
      const selected = window.getSelection()?.toString().trim() ?? "";
      if (selected.length > 0) {
        setQuery(selected.slice(0, FIND_QUERY_MAX_LENGTH));
        activeIndexRef.current = 0;
        setActiveIndex(0);
      }
    }
    input.focus();
    input.select();
  }, [focusNonce, open]);
  useEffect(
    () => () => {
      if (jumpFrameRef.current !== null) window.cancelAnimationFrame(jumpFrameRef.current);
    },
    [],
  );
  const handleQueryChange = (nextQuery: string) => {
    setQuery(nextQuery);
    activeIndexRef.current = 0;
    activeMatchRef.current = null;
    setActiveIndex(0);
  };
  const handleStep = (direction: "next" | "previous") => {
    if (deferredQuery !== query || matchCount === 0) {
      return;
    }
    const nextIndex = stepThreadFindIndex(matchCount, safeIndex, direction);
    const match = resolveThreadFindJump(matches, nextIndex);
    activeIndexRef.current = nextIndex;
    activeMatchRef.current = match;
    setActiveIndex(nextIndex);
    onActiveMatchChangeRef.current(match);
    if (match) {
      onJumpRef.current(match);
    }
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      handleStep(event.shiftKey ? "previous" : "next");
    }
  };
  return (
    <div
      role="search"
      data-testid="thread-find-bar"
      data-thread-find-layout="panel"
      className="flex w-80 max-w-[calc(100vw-1rem)] items-center gap-0.5 rounded-xl border border-border/60 bg-[var(--color-background-elevated-primary-opaque)] p-1 shadow-lg [-webkit-app-region:no-drag]"
    >
      <SearchIcon className="ml-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(event) => handleQueryChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search chat..."
        aria-label="Find in thread"
        autoComplete="off"
        spellCheck={false}
        className="font-system-ui h-8 min-w-0 flex-1 bg-transparent pl-1 text-ui text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
      <span
        className={cn(
          "w-[4.5rem] shrink-0 truncate text-right text-ui-sm tabular-nums",
          MUTED_LABEL_TEXT_CLASS_NAME,
        )}
        aria-live="polite"
      >
        {hasQuery ? (matchCount === 0 ? "No results" : `${safeIndex + 1} / ${matchCount}`) : ""}
      </span>
      <IconButton
        onClick={() => handleStep("previous")}
        disabled={matchCount === 0}
        className={FIND_STEP_BUTTON_CLASS_NAME}
        label="Previous match (Shift+Enter)"
      >
        <ArrowUp02Icon className="size-4" />
      </IconButton>
      <IconButton
        onClick={() => handleStep("next")}
        disabled={matchCount === 0}
        className={FIND_STEP_BUTTON_CLASS_NAME}
        label="Next match (Enter)"
      >
        <ArrowDown02Icon className="size-4" />
      </IconButton>
      <div aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-border" />
      <IconButton
        onClick={onClose}
        className={FIND_STEP_BUTTON_CLASS_NAME}
        label="Close find (Esc)"
      >
        <XIcon className="size-4" />
      </IconButton>
    </div>
  );
}
export function ChatThreadFindHost({
  open,
  focusNonce,
  timelineEntries,
  threadId,
  className,
  onClose,
  onJump,
  onHighlightChange,
  onActiveMatchChange,
}: ThreadFindBarProps & {
  threadId: string;
  className?: string;
}) {
  return (
    <div
      data-thread-find-host="true"
      className={cn("pointer-events-none absolute right-0 top-0 z-40", className)}
    >
      {}
      <DisclosureRegion open={open} contentClassName="pointer-events-auto p-2">
        <ThreadFindBar
          key={threadId}
          open={open}
          focusNonce={focusNonce}
          timelineEntries={timelineEntries}
          onClose={onClose}
          onJump={onJump}
          onHighlightChange={onHighlightChange}
          onActiveMatchChange={onActiveMatchChange}
        />
      </DisclosureRegion>
    </div>
  );
}
