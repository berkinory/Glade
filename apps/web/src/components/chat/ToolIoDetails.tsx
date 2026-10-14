import type { WorkLogToolDetails } from "~/lib/toolCallDetails";
import type { WorkLogToolKind } from "~/workLog.types";
import ChatMarkdown from "../ChatMarkdown";
import { MarkdownToolCodeBlock, TOOL_DETAILS_MARKDOWN_CLASS_NAME } from "./ToolDetailBlocks";
import { describeToolInput, describeToolOutput, toolInputFilePath } from "./ToolIoDetails.logic";

// Details of a tool with no dedicated presentation, such as a read, a search, a web fetch or an MCP
// call: its arguments in one box, then its result in another.
export function ToolIoDetails({
  details,
  toolKind,
}: {
  details: WorkLogToolDetails;
  toolKind: WorkLogToolKind | undefined;
}) {
  const input = details.input ? describeToolInput(details.input, toolKind) : null;
  const outputText = details.output?.output;
  const output = outputText
    ? describeToolOutput({
        text: outputText,
        toolKind,
        filePath: toolInputFilePath(details.input),
        isError: details.isError === true,
      })
    : null;
  return (
    <div className="space-y-2">
      {input ? (
        <MarkdownToolCodeBlock language="json" wrap>
          {input}
        </MarkdownToolCodeBlock>
      ) : null}
      {output?.format === "markdown" ? (
        <div className="scroll-fade-y max-h-[min(16lh,40vh)] overflow-y-auto rounded-lg border border-border/45 px-3 py-2">
          <ChatMarkdown
            text={output.text}
            cwd={undefined}
            className={TOOL_DETAILS_MARKDOWN_CLASS_NAME}
          />
        </div>
      ) : output ? (
        <MarkdownToolCodeBlock
          language={output.format === "error" ? "text" : output.language}
          title="Output"
        >
          {output.text}
        </MarkdownToolCodeBlock>
      ) : null}
      {details.output?.truncated ? (
        <p className="text-ui-xs text-muted-foreground/60">
          The output was shortened to keep the chat light.
        </p>
      ) : null}
    </div>
  );
}
