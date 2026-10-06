import { lazy, Suspense, type ReactNode } from "react";
import { createMarkdownCodeFence, formatShellTranscript } from "~/lib/toolCallDetailsFormatting";
import { cn } from "~/lib/utils";
import type { WorkLogToolDetails, WorkLogToolOutputDetails } from "../../lib/toolCallDetails";
import type { WorkLogLiveActivity } from "../../workLog.types";
import { formatLiveActivityElapsed, useLiveActivityNow } from "../../lib/liveActivityPresentation";
import ChatMarkdown from "../ChatMarkdown";
import { hasToolCallDetailsContent } from "./ToolCallDetailsDialog.logic";

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
const TOOL_DETAILS_MARKDOWN_CLASS_NAME =
  "text-ui leading-relaxed [&_pre]:max-h-[min(12lh,32vh)] [&_pre]:overflow-auto [&_pre]:leading-normal";

export function ToolCallDetailsContent({
  details,
  activity,
}: {
  details: WorkLogToolDetails | undefined;
  activity?: WorkLogLiveActivity | undefined;
}) {
  const nowMs = useLiveActivityNow(activity);
  const elapsed = activity ? formatLiveActivityElapsed(activity, nowMs) : null;

  if (!hasToolCallDetailsContent(details, activity)) return null;

  return (
    <>
      {!details && activity?.detail ? (
        <MarkdownToolCodeBlock language="text" elapsed={elapsed}>
          {activity.detail}
        </MarkdownToolCodeBlock>
      ) : null}

      {details?.command ? (
        <div className="space-y-2">
          <MarkdownToolCodeBlock language="bash" elapsed={elapsed}>
            {formatShellTranscript(details.command, details.output)}
          </MarkdownToolCodeBlock>
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

function MarkdownToolCodeBlock(props: {
  language: string;
  children: string;
  elapsed?: string | null;
}) {
  return (
    <ChatMarkdown
      text={createMarkdownCodeFence(props.language, props.children)}
      cwd={undefined}
      className={TOOL_DETAILS_MARKDOWN_CLASS_NAME}
      codeBlockMeta={props.elapsed ?? undefined}
    />
  );
}

function ToolDetailSection(props: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-ui-sm font-medium text-muted-foreground/56">{props.title}</h3>
      {props.children}
    </section>
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
        {output.stdout ? (
          <LabeledCodeBlock title="Stdout" tone="output">
            {output.stdout}
          </LabeledCodeBlock>
        ) : null}
        {output.stderr ? (
          <LabeledCodeBlock title="Stderr" tone="error">
            {output.stderr}
          </LabeledCodeBlock>
        ) : null}
        <ToolOutputMetadata output={output} />
      </div>
    </ToolDetailSection>
  );
}

function LabeledCodeBlock(props: { title: string; tone: "output" | "error"; children: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/45 bg-background/58">
      <div
        className={cn(
          DETAIL_HEADER_CLASS_NAME,
          props.tone === "error" ? "text-rose-200/88" : "text-muted-foreground/60",
        )}
      >
        {props.title}
      </div>
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
