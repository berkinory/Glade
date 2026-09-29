const FENCE_PATTERN = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const FENCED_CODE_SPLIT_PATTERN = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/;
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;

const FORMATTING_TAG_PATTERN = /<\/?(?:sub|sup|ins|kbd|samp)>/gi;
const HTML_LINE_BREAK_PATTERN = /<br\s*\/?>/gi;
const DETAILS_PATTERN =
  /<details[^>]*>\s*(?:<summary[^>]*>([\s\S]*?)<\/summary>)?([\s\S]*?)<\/details>/gi;
const HTML_TAG_PATTERN = /<[^>]+>/g;

export type PullRequestMarkdownSection =
  | { kind: "markdown"; text: string }
  | { kind: "details"; summary: string; body: string };

function fenceRanges(markdown: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const match of markdown.matchAll(FENCE_PATTERN)) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

function insideAnyRange(index: number, ranges: ReadonlyArray<[number, number]>): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function stripHtmlComments(markdown: string): string {
  return markdown
    .split(FENCED_CODE_SPLIT_PATTERN)
    .map((segment, index) =>
      index % 2 === 1 ? segment : segment.replace(HTML_COMMENT_PATTERN, ""),
    )
    .join("")
    .trim();
}

// Strips template comments, resolves bare `<br>` tags into newlines, and drops the inline
// formatting wrappers the renderer would otherwise print literally (all outside fences).
export function preparePullRequestMarkdown(markdown: string): string {
  const withoutComments = stripHtmlComments(markdown);
  const ranges = fenceRanges(withoutComments);
  return withoutComments
    .replace(HTML_LINE_BREAK_PATTERN, (tag, offset: number) =>
      insideAnyRange(offset, ranges) ? tag : "\n",
    )
    .replace(FORMATTING_TAG_PATTERN, (tag, offset: number) =>
      insideAnyRange(offset, ranges) ? tag : "",
    )
    .trim();
}

export function pullRequestMarkdownPreview(markdown: string): string {
  const sections = splitPullRequestMarkdownSections(preparePullRequestMarkdown(markdown));
  const text = sections
    .filter((section) => section.kind === "markdown")
    .map((section) => section.text)
    .join("\n");
  return text

    .replace(FENCE_PATTERN, "[code]")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(HTML_TAG_PATTERN, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/(\*\*|__|\*|_|~~|`)/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function splitPullRequestMarkdownSections(markdown: string): PullRequestMarkdownSection[] {
  const ranges = fenceRanges(markdown);
  const sections: PullRequestMarkdownSection[] = [];
  let cursor = 0;

  for (const match of markdown.matchAll(DETAILS_PATTERN)) {
    if (insideAnyRange(match.index, ranges)) continue;
    const leading = markdown.slice(cursor, match.index).trim();
    if (leading.length > 0) sections.push({ kind: "markdown", text: leading });
    const summary = (match[1] ?? "").replace(HTML_TAG_PATTERN, "").trim() || "Details";
    sections.push({ kind: "details", summary, body: (match[2] ?? "").trim() });
    cursor = match.index + match[0].length;
  }

  const trailing = markdown.slice(cursor).trim();
  if (trailing.length > 0) sections.push({ kind: "markdown", text: trailing });
  return sections;
}
