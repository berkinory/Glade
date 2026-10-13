import { lazy, Suspense } from "react";
import { formatShellCommand, formatToolOutputText } from "~/lib/toolCallDetailsFormatting";
import {
  commandFileEffects,
  commandScriptParts,
  resolveCommandPaths,
} from "~/lib/commandFileEffects";
import { commandReadFilePaths, commandReadRange } from "~/lib/toolCallLabel.commands";
import { commandSearchMatches, type SearchMatch } from "~/lib/commandOutcome";
import { basenameOfPath } from "~/file-icons";
import { openWorkspaceFileReference, useWorkspaceFileOpener } from "~/lib/workspaceFileOpener";
import { FileNameChip } from "./FileNameChip";
import { cn } from "~/lib/utils";
import type { WorkLogToolDetails, WorkLogToolOutputDetails } from "../../lib/toolCallDetails";
import type { WorkLogLiveActivity, WorkLogToolKind } from "../../workLog.types";
import { formatLiveActivityElapsed, useLiveActivityNow } from "../../lib/liveActivityPresentation";
import { MarkdownToolCodeBlock, ToolDetailSection } from "./ToolDetailBlocks";
import { hasToolCallDetailsContent } from "./ToolCallDetailsDialog.logic";
import { ToolIoDetails } from "./ToolIoDetails";

// The diff renderer pulls in its worker pool, so it loads only once a tool's details are opened.
const ToolPatchDiff = lazy(() =>
  import("./ToolDiffView").then((module) => ({ default: module.ToolPatchDiff })),
);
const ToolEditsDiff = lazy(() =>
  import("./ToolDiffView").then((module) => ({ default: module.ToolEditsDiff })),
);

const DETAIL_HEADER_CLASS_NAME = "border-b border-border/45 px-3 py-2 text-ui-xs font-medium";
const DETAIL_CODE_BLOCK_CLASS_NAME =
  "max-h-[min(12lh,32vh)] overflow-auto whitespace-pre-wrap break-words font-chat-code text-chat-code leading-relaxed text-foreground/88";

export function ToolCallDetailsContent({
  details,
  activity,
  toolKind,
  fileDiffOpener,
}: {
  details: WorkLogToolDetails | undefined;
  activity?: WorkLogLiveActivity | undefined;
  toolKind?: WorkLogToolKind | undefined;
  fileDiffOpener?: FileDiffOpener | undefined;
}) {
  const nowMs = useLiveActivityNow(activity);
  const elapsed = activity ? formatLiveActivityElapsed(activity, nowMs) : null;

  if (!hasToolCallDetailsContent(details, activity, toolKind)) return null;
  if (details?.kind === "tool") return <ToolIoDetails details={details} toolKind={toolKind} />;
  const searchMatches = details?.command
    ? commandSearchMatches(details.command, details.output)
    : null;
  // A search's output is its matches; listed as links, the raw text would only repeat them unless
  // there are more than the list shows.
  const commandOutputText =
    details?.command && (!searchMatches?.length || searchMatches.length > MAX_LISTED_SEARCH_MATCHES)
      ? formatToolOutputText(details.output)
      : null;

  return (
    <>
      {!details && activity?.detail ? (
        <MarkdownToolCodeBlock language="text" elapsed={elapsed}>
          {activity.detail}
        </MarkdownToolCodeBlock>
      ) : null}

      {details?.command ? (
        <div className="space-y-2">
          <CommandFiles command={details.command} fileDiffOpener={fileDiffOpener} />
          <CommandScript command={details.command} elapsed={elapsed} />
          {searchMatches?.length ? (
            <CommandSearchMatches command={details.command} matches={searchMatches} />
          ) : null}
          {commandOutputText ? (
            <MarkdownToolCodeBlock language="text">{commandOutputText}</MarkdownToolCodeBlock>
          ) : null}
          {details.output ? <ToolOutputMetadata output={details.output} /> : null}
        </div>
      ) : null}

      {details?.files?.length ? (
        <ToolDetailSection title="Files">
          <div className="flex flex-wrap gap-1.5">
            {details.files.map((file) => (
              <span
                key={file}
                className="max-w-full rounded-md border border-border/45 bg-background/70 px-2 py-1 font-chat-code text-chat-code text-foreground/82"
                title={file}
              >
                {file}
              </span>
            ))}
          </div>
        </ToolDetailSection>
      ) : null}

      {details?.diff ? (
        <ToolDetailSection title="Diff">
          <Suspense fallback={null}>
            <ToolPatchDiff
              patch={details.diff}
              fallback={(text) => (
                <MarkdownToolCodeBlock language="diff">{text}</MarkdownToolCodeBlock>
              )}
            />
          </Suspense>
        </ToolDetailSection>
      ) : null}

      {details?.edits?.length ? (
        <ToolDetailSection title="Edits">
          <Suspense fallback={null}>
            <ToolEditsDiff edits={details.edits} />
          </Suspense>
        </ToolDetailSection>
      ) : null}

      {details?.content ? (
        <ToolDetailSection title="Written Content">
          <MarkdownToolCodeBlock language="text">{details.content}</MarkdownToolCodeBlock>
        </ToolDetailSection>
      ) : null}

      {details?.output && !details.command ? <ToolOutputSection output={details.output} /> : null}
      {details && !details.command && elapsed ? (
        <p className="text-ui-xs tabular-nums text-muted-foreground/68">{elapsed}</p>
      ) : null}
    </>
  );
}

// A shell command names the files it wrote or read, each opening like a Read or Edit tool's file;
// a file it changed also opens in the turn's diff.
export interface FileDiffOpener {
  has: (path: string) => boolean;
  open: (path: string) => void;
}

function CommandFiles({
  command,
  fileDiffOpener,
}: {
  command: string;
  fileDiffOpener: FileDiffOpener | undefined;
}) {
  const opener = useWorkspaceFileOpener();
  const effects = commandFileEffects(command);
  const written = new Set(resolveCommandPaths(command, effects.written));
  const files = [
    ...new Set([
      ...written,
      ...resolveCommandPaths(command, effects.read),
      ...commandReadFilePaths(command),
    ]),
  ];
  if (files.length === 0) return null;
  // A read of one range opens where it starts.
  const range = files.length === 1 ? commandReadRange(command) : null;
  const line = range && "start" in range ? range.start : null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-ui-sm" data-command-files="true">
      {files.map((file) => (
        <span key={file} className="inline-flex min-w-0 items-center gap-1">
          <FileNameChip
            path={file}
            onOpen={
              opener
                ? () => openWorkspaceFileReference(opener, line ? `${file}:${line}` : file)
                : undefined
            }
          />
          {written.has(file) && fileDiffOpener?.has(file) ? (
            <button
              type="button"
              className="rounded-md px-1 text-ui-xs text-muted-foreground hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground"
              onClick={() => fileDiffOpener.open(file)}
            >
              Diff
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
}

const MAX_LISTED_SEARCH_MATCHES = 40;

// Each match opens its file at the matching line.
function CommandSearchMatches({
  command,
  matches,
}: {
  command: string;
  matches: readonly SearchMatch[];
}) {
  const opener = useWorkspaceFileOpener();
  const listed = matches.slice(0, MAX_LISTED_SEARCH_MATCHES);
  const paths = resolveCommandPaths(
    command,
    listed.map((match) => match.file),
  );
  const resolvedPath = new Map(listed.map((match, index) => [match, paths[index] ?? match.file]));
  return (
    <div
      className="max-h-[min(16lh,40vh)] space-y-0.5 overflow-y-auto rounded-lg border border-border/45 px-2 py-1.5 text-ui-sm"
      data-command-search-matches="true"
    >
      {listed.map((match, index) => {
        const path = resolvedPath.get(match) ?? match.file;
        const target = match.line !== null ? `${path}:${match.line}` : path;
        return (
          <button
            // Matches repeat; the position keeps keys unique.
            key={`${index}:${target}`}
            type="button"
            disabled={!opener}
            className="flex w-full min-w-0 items-baseline gap-1.5 rounded-md px-1 text-left hover:bg-[var(--color-background-button-secondary-hover)]"
            onClick={() => openWorkspaceFileReference(opener, target)}
          >
            <span className="shrink-0 font-chat-code text-chat-code text-foreground/85">
              {basenameOfPath(match.file)}
              {match.line !== null ? (
                <span className="text-muted-foreground">:{match.line}</span>
              ) : null}
            </span>
            {match.text ? (
              <span className="min-w-0 truncate font-chat-code text-chat-code text-muted-foreground">
                {match.text}
              </span>
            ) : null}
          </button>
        );
      })}
      {matches.length > listed.length ? (
        <p className="px-1 text-ui-xs text-muted-foreground">
          {matches.length - listed.length} more in the output below
        </p>
      ) : null}
    </div>
  );
}

// A heredoc's body is code in its own language: the command line stays bash, the body gets its own
// box so a Python edit or a written file reads as itself.
function CommandScript({ command, elapsed }: { command: string; elapsed: string | null }) {
  const parts = commandScriptParts(command);
  return (
    <>
      <MarkdownToolCodeBlock language="bash" elapsed={elapsed} wrap>
        {formatShellCommand(parts?.head ?? command)}
      </MarkdownToolCodeBlock>
      {parts ? (
        <MarkdownToolCodeBlock language={parts.language}>{parts.body}</MarkdownToolCodeBlock>
      ) : null}
      {parts?.tail ? (
        <MarkdownToolCodeBlock language="bash" wrap>
          {parts.tail}
        </MarkdownToolCodeBlock>
      ) : null}
    </>
  );
}

function ToolOutputMetadata({ output }: { output: WorkLogToolOutputDetails }) {
  if (output.exitCode === undefined && !output.truncated) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-ui-sm text-muted-foreground/68">
      {output.exitCode !== undefined ? (
        <span className="rounded-full border border-border/45 px-2 py-0.5">
          Exit code {output.exitCode}
        </span>
      ) : null}
      {output.truncated ? (
        <span className="rounded-full border border-amber-500/30 bg-amber-500/8 px-2 py-0.5 text-amber-200/90">
          Truncated
        </span>
      ) : null}
    </div>
  );
}

function ToolOutputSection({ output }: { output: WorkLogToolOutputDetails }) {
  return (
    <ToolDetailSection title="Output">
      <div className="space-y-3">
        {output.output ? (
          <MarkdownToolCodeBlock language="text">{output.output}</MarkdownToolCodeBlock>
        ) : null}
        {output.stdout ? <LabeledCodeBlock title="Stdout">{output.stdout}</LabeledCodeBlock> : null}
        {output.stderr ? <LabeledCodeBlock title="Stderr">{output.stderr}</LabeledCodeBlock> : null}
        <ToolOutputMetadata output={output} />
      </div>
    </ToolDetailSection>
  );
}

function LabeledCodeBlock(props: { title: string; children: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/45 bg-background/58">
      <div className={cn(DETAIL_HEADER_CLASS_NAME, "text-muted-foreground/60")}>{props.title}</div>
      <ToolCodeBlock bare>{props.children}</ToolCodeBlock>
    </div>
  );
}

function ToolCodeBlock(props: { children: string; tone?: "default" | "command"; bare?: boolean }) {
  return (
    <pre
      className={cn(
        DETAIL_CODE_BLOCK_CLASS_NAME,
        props.tone === "command" && "text-sky-100/92",
        props.bare
          ? "px-3 py-2.5"
          : "rounded-lg border border-border/45 bg-background/70 px-3 py-2.5",
      )}
    >
      {props.children}
    </pre>
  );
}
