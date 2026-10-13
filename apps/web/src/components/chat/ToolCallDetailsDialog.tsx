import { lazy, Suspense } from "react";
import { formatShellCommand, formatToolOutputText } from "~/lib/toolCallDetailsFormatting";
import { commandReadFilePaths } from "~/lib/toolCallLabel.commands";
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
}: {
  details: WorkLogToolDetails | undefined;
  activity?: WorkLogLiveActivity | undefined;
  toolKind?: WorkLogToolKind | undefined;
}) {
  const nowMs = useLiveActivityNow(activity);
  const elapsed = activity ? formatLiveActivityElapsed(activity, nowMs) : null;

  if (!hasToolCallDetailsContent(details, activity, toolKind)) return null;
  if (details?.kind === "tool") return <ToolIoDetails details={details} toolKind={toolKind} />;
  const commandOutputText = details?.command ? formatToolOutputText(details.output) : null;

  return (
    <>
      {!details && activity?.detail ? (
        <MarkdownToolCodeBlock language="text" elapsed={elapsed}>
          {activity.detail}
        </MarkdownToolCodeBlock>
      ) : null}

      {details?.command ? (
        <div className="space-y-2">
          <CommandReadFiles command={details.command} />
          <MarkdownToolCodeBlock language="bash" elapsed={elapsed} wrap>
            {formatShellCommand(details.command)}
          </MarkdownToolCodeBlock>
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

// A shell read names the files it read, each opening like a Read tool's file.
function CommandReadFiles({ command }: { command: string }) {
  const opener = useWorkspaceFileOpener();
  const files = commandReadFilePaths(command);
  if (files.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 text-ui-sm" data-command-read-files="true">
      {files.map((file) => (
        <FileNameChip
          key={file}
          path={file}
          onOpen={opener ? () => openWorkspaceFileReference(opener, file) : undefined}
        />
      ))}
    </div>
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
