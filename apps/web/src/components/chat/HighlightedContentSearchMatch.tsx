import { Suspense, use } from "react";
import {
  createContentSearchPattern,
  type ContentSearchOptions,
} from "@glade/shared/text/searchQuery";
import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { getSyntaxHighlighterPromise, getSyntaxLanguageForPath } from "~/lib/syntaxHighlighting";
import { ContentSearchMatchText } from "../ContentSearchMatchText";

type Props = { path: string; text: string; query: string } & ContentSearchOptions;

function HighlightedLine(props: Props) {
  const language = getSyntaxLanguageForPath(props.path);
  const highlighter = use(getSyntaxHighlighterPromise(language));
  const { resolvedTheme } = useTheme();
  const loadedLanguage = highlighter.getLoadedLanguages().includes(language) ? language : "text";
  const tokens = highlighter
    .codeToTokens(props.text, { lang: loadedLanguage, theme: resolveDiffThemeName(resolvedTheme) })
    .tokens.flat();
  const ranges = [...props.text.matchAll(createContentSearchPattern(props.query, props))].map(
    (match) => ({ start: match.index, end: match.index + match[0].length }),
  );
  let offset = 0;
  return (
    <>
      {tokens.map((token) => {
        const start = offset;
        offset += token.content.length;
        const boundaries = [
          start,
          offset,
          ...ranges
            .flatMap((range) => [range.start, range.end])
            .filter((boundary) => boundary > start && boundary < offset),
        ].toSorted((a, b) => a - b);
        return (
          <span key={start} style={{ color: token.color }}>
            {boundaries.slice(0, -1).map((position, index) => {
              const text = token.content.slice(position - start, boundaries[index + 1]! - start);
              return ranges.some((range) => position >= range.start && position < range.end) ? (
                <mark key={position} className="rounded-[2px] bg-primary/20 text-inherit">
                  {text}
                </mark>
              ) : (
                <span key={position}>{text}</span>
              );
            })}
          </span>
        );
      })}
    </>
  );
}

export function HighlightedContentSearchMatch(props: Props) {
  const plain = <ContentSearchMatchText {...props} />;
  if (props.text.length > 1_000 || getSyntaxLanguageForPath(props.path) === "text") return plain;
  return (
    <Suspense fallback={plain}>
      <HighlightedLine {...props} />
    </Suspense>
  );
}
