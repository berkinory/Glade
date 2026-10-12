import "katex/dist/katex.min.css";
import rehypeKatex from "rehype-katex";
import type { Options as MarkdownOptions } from "react-markdown";

export const MATH_REHYPE_PLUGINS: NonNullable<MarkdownOptions["rehypePlugins"]> = [
  [
    rehypeKatex,
    {
      output: "htmlAndMathml",
      strict: false,
      throwOnError: false,
    },
  ],
];
