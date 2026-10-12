import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import type { Options as MarkdownOptions } from "react-markdown";

import { CHAT_FIND_TEXT_TAG_NAME } from "./ChatMarkdownFind";

// GitHub's sanitize schema (no scripts, styles, event handlers, forms, frames or unsafe URL
// schemes), widened only for the markup Glade's own Markdown plugins generate and for `file:`
// links, which the renderer rewrites into workspace file chips.
const AUTHORED_HTML_SCHEMA: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), CHAT_FIND_TEXT_TAG_NAME],
  attributes: {
    ...defaultSchema.attributes,
    [CHAT_FIND_TEXT_TAG_NAME]: ["dataChatFindTextStart"],
    blockquote: [
      ...(defaultSchema.attributes?.blockquote ?? []),
      ["dataGithubAlert", "note", "tip", "important", "warning", "caution"],
    ],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "file"],
  },
};

// Sanitizing must run directly after parsing, before any plugin that trusts the tree.
export const AUTHORED_HTML_REHYPE_PLUGINS: NonNullable<MarkdownOptions["rehypePlugins"]> = [
  rehypeRaw,
  [rehypeSanitize, AUTHORED_HTML_SCHEMA],
];
