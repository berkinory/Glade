import type { Root } from "mdast";
import type { Plugin } from "unified";

export interface MarkdownBlock {
  source: string;
  offset: number;
  // Lines before the block, so block-relative source lines can be mapped back to the document.
  line: number;
}

function countLines(text: string): number {
  let lines = 0;
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
    lines += 1;
  }
  return lines;
}

// Every link reference or footnote definition contains `]:`, and a definition anywhere can change
// how earlier blocks parse. A streaming CR can become half of a CRLF, and a BOM at a block start
// would be stripped although it is inside the document.
function mustRenderWhole(text: string): boolean {
  return text.includes("]:") || text.includes("\r") || text.includes("\uFEFF");
}

/** Adapted from T3 Code (MIT), Copyright (c) 2026 T3 Tools Inc.
 * https://github.com/pingdotgg/t3code/blob/main/apps/web/src/markdown-incremental.ts
 * Splits a streaming message into top-level blocks that parse the same alone as inside the whole
 * document, so only the open tail re-parses while text arrives. The tail's own parse reveals the
 * boundaries: a top-level node followed by a blank line and a next top-level node whose first line
 * is complete. Later text cannot change how anything before that next node parses.
 */
export interface MarkdownBlockSplitter {
  // Committed blocks followed by the open tail; a single block when nothing is committed. Only a
  // growing message commits a newly found boundary, so completing a reply never moves its last
  // node into a new block.
  split(text: string, growing: boolean): MarkdownBlock[];
  // Remark plugin for the open tail's render that records the boundary its parse reveals.
  observeTail: Plugin<[MarkdownBlock], Root>;
}

export function createMarkdownBlockSplitter(): MarkdownBlockSplitter {
  let committedBlocks: MarkdownBlock[] = [];
  let committedText = "";
  let committedLines = 0;
  // Everything before the last boundary found in the tail, committed as one block: content that
  // stays in the block it was rendered in keeps its React state, and only the newest node moves.
  let pendingBlock: string | null = null;

  function findLastBoundary(source: string, root: Root): number | null {
    for (let index = root.children.length - 2; index >= 0; index--) {
      const end = root.children[index]!.position?.end.offset;
      const nextStart = root.children[index + 1]!.position?.start.offset;
      if (end === undefined || nextStart === undefined) return null;
      const lineStart = source.lastIndexOf("\n", nextStart - 1) + 1;
      // A partial first line can still change its meaning, e.g. `1` becoming the list item `1.`.
      if (!source.includes("\n", nextStart)) continue;
      if (lineStart <= end || !/\n[ \t]*\n/.test(source.slice(end, lineStart))) continue;
      return lineStart;
    }
    return null;
  }

  return {
    split(text, growing) {
      const whole = { source: text, offset: 0, line: 0 };
      if (mustRenderWhole(text)) return [whole];
      if (!text.startsWith(committedText)) {
        committedBlocks = [];
        committedText = "";
        committedLines = 0;
        pendingBlock = null;
      }
      if (growing && pendingBlock !== null && text.startsWith(committedText + pendingBlock)) {
        committedBlocks.push({
          source: pendingBlock,
          offset: committedText.length,
          line: committedLines,
        });
        committedText += pendingBlock;
        committedLines += countLines(pendingBlock);
      }
      pendingBlock = null;
      if (committedBlocks.length === 0) return [whole];
      return [
        ...committedBlocks,
        {
          source: text.slice(committedText.length),
          offset: committedText.length,
          line: committedLines,
        },
      ];
    },
    // Installed only on the open tail's render. ReactMarkdown creates a processor per render whose
    // first parse is the document; transforms can then parse synthetic recovery text on that same
    // processor, and those parses must not record boundaries.
    observeTail(tail) {
      const parse = this.parser;
      if (!parse) return;
      let documentParsed = false;
      this.parser = (document, file) => {
        const root = parse(document, file) as Root;
        // A stale or repeated parse of an earlier tail has nothing new to record.
        if (!documentParsed && tail.offset === committedText.length) {
          const boundary = findLastBoundary(tail.source, root);
          if (boundary !== null) pendingBlock = tail.source.slice(0, boundary);
        }
        documentParsed = true;
        return root;
      };
    },
  };
}
