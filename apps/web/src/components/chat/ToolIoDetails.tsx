import { useState } from "react";
import type { WorkLogToolDetails } from "~/lib/toolCallDetails";
import { openWorkspaceFileReference, useWorkspaceFileOpener } from "~/lib/workspaceFileOpener";
import { cn } from "~/lib/utils";
import type { WorkLogToolKind } from "~/workLog.types";
import ChatMarkdown from "../ChatMarkdown";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { FileNameChip } from "./FileNameChip";
import { MarkdownToolCodeBlock, TOOL_DETAILS_MARKDOWN_CLASS_NAME } from "./ToolDetailBlocks";
import {
  describeToolInput,
  describeToolOutput,
  toolInputFilePath,
  type ToolInputField,
} from "./ToolIoDetails.logic";

const ARGUMENT_CHIP_CLASS_NAME =
  "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-border/50 px-1.5 py-px text-ui-xs";

// Details of a tool with no dedicated presentation, such as a read, a search, a web fetch or an MCP
// call: its arguments as a strip of chips, then its result in one box.
export function ToolIoDetails({
  details,
  toolKind,
}: {
  details: WorkLogToolDetails;
  toolKind: WorkLogToolKind | undefined;
}) {
  const [openField, setOpenField] = useState<string | null>(null);
  const filePath = toolInputFilePath(details.input);
  const fields = details.input ? describeToolInput(details.input, toolKind) : [];
  const expanded = fields.find(
    (field): field is Extract<ToolInputField, { layout: "block" }> =>
      field.key === openField && field.layout === "block",
  );
  const outputText = details.output?.output;
  const output = outputText
    ? describeToolOutput({
        text: outputText,
        toolKind,
        filePath,
        isError: details.isError === true,
      })
    : null;
  return (
    <div className="space-y-2">
      {fields.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {fields.map((field) =>
            field.layout === "inline" ? (
              <span key={field.key} className={ARGUMENT_CHIP_CLASS_NAME}>
                <span className="shrink-0 text-muted-foreground/60">{field.key}</span>
                {field.text === filePath ? (
                  <FilePathValue path={filePath} />
                ) : (
                  <span className="truncate font-chat-code text-foreground/80">{field.text}</span>
                )}
              </span>
            ) : (
              <BlockFieldChip
                key={field.key}
                field={field}
                open={openField === field.key}
                onToggle={() => setOpenField(openField === field.key ? null : field.key)}
              />
            ),
          )}
        </div>
      ) : null}
      {expanded ? (
        <MarkdownToolCodeBlock language={expanded.language}>{expanded.text}</MarkdownToolCodeBlock>
      ) : null}
      {output?.format === "error" ? (
        <p className="whitespace-pre-wrap break-words font-chat-code text-chat-code text-destructive/85">
          {output.text}
        </p>
      ) : output?.format === "markdown" ? (
        <div className="scroll-fade-y max-h-[min(16lh,40vh)] overflow-y-auto rounded-lg border border-border/45 px-3 py-2">
          <ChatMarkdown
            text={output.text}
            cwd={undefined}
            className={TOOL_DETAILS_MARKDOWN_CLASS_NAME}
          />
        </div>
      ) : output ? (
        <MarkdownToolCodeBlock language={output.language}>{output.text}</MarkdownToolCodeBlock>
      ) : null}
      {details.output?.truncated ? (
        <p className="text-ui-xs text-muted-foreground/60">
          The output was shortened to keep the chat light.
        </p>
      ) : null}
    </div>
  );
}

// A long or structured argument shows its first line; the chip opens the whole value below.
function BlockFieldChip({
  field,
  open,
  onToggle,
}: {
  field: ToolInputField;
  open: boolean;
  onToggle: () => void;
}) {
  const firstLine =
    field.text
      .split("\n")
      .find((line) => line.trim())
      ?.trim() ?? "";
  return (
    <button
      type="button"
      aria-expanded={open}
      className={cn(
        ARGUMENT_CHIP_CLASS_NAME,
        "hover:bg-[var(--color-background-button-secondary-hover)]",
        open && "bg-[var(--color-background-button-secondary)]",
      )}
      onClick={onToggle}
    >
      <span className="shrink-0 text-muted-foreground/60">{field.key}</span>
      <span className="truncate font-chat-code text-foreground/80">{firstLine}</span>
      <DisclosureChevron open={open} className="shrink-0 text-muted-foreground/60" />
    </button>
  );
}

function FilePathValue({ path }: { path: string }) {
  const opener = useWorkspaceFileOpener();
  return (
    <FileNameChip
      path={path}
      className="bg-transparent px-0"
      onOpen={opener ? () => openWorkspaceFileReference(opener, path) : undefined}
    />
  );
}
