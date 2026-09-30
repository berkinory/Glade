import { describe, expect, it } from "vitest";

import { createIncrementalHighlightedDocument } from "./incrementalHighlighting";
import { getSyntaxHighlighterPromise } from "./syntaxHighlighting";
import { resolveDiffThemeName } from "./diffRendering";

const examples = [
  [
    "typescript",
    "/* multiline\ncomment */\nconst value = `first\n${1 + 2}\nlast`;\nconst done = true;",
  ],
  ["tsx", 'const view = <div title="hello">\n  <span>{`first\nlast`}</span>\n</div>;'],
  [
    "html",
    '<script>\n/* comment\nends */\nconst value = "ok";\n</script>\n<style>\nbody { color: red; }\n</style>',
  ],
  ["python", 'value = """first\nsecond\nthird"""\nprint(value)\n'],
] as const;

describe("incremental TextMate continuation", () => {
  it.each(examples)(
    "matches full %s highlighting across incomplete lines and edits",
    async (language, code) => {
      const highlighter = await getSyntaxHighlighterPromise(language);
      const theme = resolveDiffThemeName("dark");
      for (const chunkSize of [1, 7, 43]) {
        const highlight = createIncrementalHighlightedDocument(highlighter, language, theme);
        for (let end = chunkSize; end < code.length + chunkSize; end += chunkSize) {
          const prefix = code.slice(0, end);
          expect(highlight(prefix)).toEqual(
            highlighter.codeToHast(prefix, { lang: language, theme }),
          );
        }
        const edited = code.replace("first", "changed");
        expect(highlight(edited)).toEqual(
          highlighter.codeToHast(edited, { lang: language, theme }),
        );
        const crlf = code.replaceAll("\n", "\r\n");
        expect(highlight(crlf)).toEqual(highlighter.codeToHast(crlf, { lang: language, theme }));
      }
    },
    20_000,
  );
});
