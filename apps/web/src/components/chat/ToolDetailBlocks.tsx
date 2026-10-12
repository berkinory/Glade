import type { ReactNode } from "react";
import { createMarkdownCodeFence } from "~/lib/toolCallDetailsFormatting";
import { cn } from "~/lib/utils";
import ChatMarkdown from "../ChatMarkdown";

export const TOOL_DETAILS_MARKDOWN_CLASS_NAME =
  "text-ui leading-relaxed [&_pre]:max-h-[min(12lh,32vh)] [&_pre]:overflow-auto [&_pre]:leading-normal";

export function MarkdownToolCodeBlock(props: {
  language: string;
  children: string;
  elapsed?: string | null;
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
    />
  );
}

export function ToolDetailSection(props: {
  title: string;
  tone?: "default" | "error";
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3
        className={cn(
          "text-ui-sm font-medium",
          props.tone === "error" ? "text-destructive/85" : "text-muted-foreground/56",
        )}
      >
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}
