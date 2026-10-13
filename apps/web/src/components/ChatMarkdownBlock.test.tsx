import { renderToStaticMarkup } from "react-dom/server";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";

import { createMarkdownBlockSplitter, type MarkdownBlockSplitter } from "../markdownIncremental";
import { MarkdownBlock, type MarkdownPipeline } from "./ChatMarkdownBlock";

const PIPELINE: MarkdownPipeline = {
  cacheKey: "test",
  remarkPlugins: [remarkGfm],
  components: {
    li: ({ node, children }) => <li data-line={node?.position?.start.line}>{children}</li>,
  },
  rehype: "assistant",
};

function renderBlocks(
  blocks: ReturnType<MarkdownBlockSplitter["split"]>,
  observedBy?: MarkdownBlockSplitter,
) {
  return renderToStaticMarkup(
    <>
      {blocks.map((block) => (
        <MarkdownBlock
          key={block.offset}
          {...block}
          rawSource={block.source}
          pipeline={PIPELINE}
          observedBy={observedBy}
          cacheable={false}
        />
      ))}
    </>,
  );
}

// Streams one character at a time, rendering the open tail so the splitter commits what its parse
// reveals, then renders the committed blocks of the complete text.
function renderStreamed(text: string) {
  const splitter = createMarkdownBlockSplitter();
  for (let end = 1; end <= text.length; end++) {
    renderBlocks(splitter.split(text.slice(0, end), true).slice(-1), splitter);
  }
  const blocks = splitter.split(text, false);
  return { blockCount: blocks.length, markup: renderBlocks(blocks) };
}

describe("streamed markdown blocks", () => {
  it.each([
    {
      name: "a list item that only becomes one once its line completes",
      text: "1. first\n\n1. second\n\nAfter.\n\nEnd.\n",
    },
    { name: "a loose list", text: "- a\n\n- b\n\n  continued\n\n- c\n\nAfter.\n\nEnd.\n" },
    {
      name: "a fence with blank lines",
      text: "Intro.\n\n```ts\nconst a = 1;\n\n\nconst b = 2;\n```\n\nOutro.\n",
    },
    { name: "a break tag alone between blocks", text: "Before.\n\n<br>\n\nAfter.\n\nEnd.\n" },
    {
      name: "source offsets and task lines in later blocks",
      text: "Intro text.\n\n- [ ] one\n- [x] two\n\nClosing words 😀 here.\n\n> quoted\n",
    },
  ])("renders $name the same as the whole message", ({ text }) => {
    const streamed = renderStreamed(text);

    expect(streamed.blockCount).toBeGreaterThan(1);
    expect(streamed.markup).toBe(renderBlocks([{ source: text, offset: 0, line: 0 }]));
  });

  it.each([
    {
      name: "link reference",
      text: "See [docs].\n\nMiddle.\n\nMore.\n\n[docs]: https://example.com\n",
    },
    { name: "footnote", text: "Claim[^1].\n\nMiddle.\n\nMore.\n\n[^1]: The note.\n" },
  ])("lets a late $name definition resolve earlier blocks", ({ text }) => {
    const whole = renderBlocks([{ source: text, offset: 0, line: 0 }]);

    expect(whole).toContain("<a href=");
    expect(renderStreamed(text).markup).toBe(whole);
  });
});
