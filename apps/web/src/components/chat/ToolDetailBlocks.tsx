import type { ReactNode } from "react";
import { createMarkdownCodeFence } from "~/lib/toolCallDetailsFormatting";
import { cn } from "~/lib/utils";
import ChatMarkdown from "../ChatMarkdown";

export const TOOL_DETAILS_MARKDOWN_CLASS_NAME =
  "text-ui leading-relaxed [&_pre]:max-h-[min(12lh,32vh)] [&_pre]:overflow-auto [&_pre]:leading-normal";

export function MarkdownToolCodeBlock(props: {
  language: string;
  children: string;
  // Header text on the right, such as how long a command ran or how it exited.
  elapsed?: string | null;
  // Header text on the left in place of the language, such as "Output".
  title?: string;
  // Short content that must be read whole, such as a command, wraps instead of scrolling sideways.
  wrap?: boolean;
}) {
  return (
    <ChatMarkdown
      text={createMarkdownCodeFence(props.language, props.children)}
      cwd={undefined}
      className={cn(
        TOOL_DETAILS_MARKDOWN_CLASS_NAME,
        props.wrap && "[&_pre]:break-words [&_pre]:whitespace-pre-wrap",
      )}
      codeBlockMeta={props.elapsed ?? undefined}
      codeBlockTitle={props.title}
    />
  );
}

export function ToolDetailSection(props: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-ui-sm font-medium text-muted-foreground/56">{props.title}</h3>
      {props.children}
    </section>
  );
}
