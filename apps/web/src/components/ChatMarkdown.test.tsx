import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@pierre/diffs", () => ({
  getFiletypeFromFileName: (fileName: string) => (fileName.endsWith(".ts") ? "ts" : "text"),
  getSharedHighlighter: () =>
    Promise.resolve({
      codeToHtml(code: string) {
        return `<pre class="shiki"><code>${code}</code></pre>`;
      },
    }),
}));

vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

function renderWithQueryClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToStaticMarkup(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

async function renderMarkdown(text: string, cwd = "C:\\Users\\LENOVO\\glade") {
  const { default: ChatMarkdown } = await import("./ChatMarkdown");

  return renderWithQueryClient(<ChatMarkdown text={text} cwd={cwd} isStreaming={false} />);
}

async function renderUserMarkdown(text: string) {
  const { default: ChatMarkdown } = await import("./ChatMarkdown");

  return renderWithQueryClient(
    <ChatMarkdown text={text} cwd={undefined} isStreaming={false} variant="user" />,
  );
}

describe("ChatMarkdown", () => {
  it("keeps links and code intact when math is present", async () => {
    const markup = await renderMarkdown(
      [
        "Read [local notes](./notes.md) and [external docs](https://example.com).",
        "",
        "Inline math $x^2 + y^2$ still renders.",
        "",
        "Inline code `$z$` stays literal.",
        "",
        "```ts",
        'const price = "$5";',
        "```",
      ].join("\n"),
    );

    expect(markup).toContain('href="./notes.md"');
    expect(markup).not.toContain('href="./notes.md" target="_blank"');
    expect(markup).toContain(
      'href="https://example.com" target="_blank" rel="noopener noreferrer"',
    );
    expect(markup).toContain("<code>$z$</code>");
    expect(markup).toContain("const price = &quot;$5&quot;;");
    expect(markup.match(/class="katex"/g) ?? []).toHaveLength(1);
  });

  it("keeps bracketed display formulas intact without swallowing subsequent prose and tables", async () => {
    const markup = await renderMarkdown(String.raw`- **Decay gate**:

$$
\alpha_t
=
\exp\left[-\exp(A)\operatorname{softplus}(W_\alpha x_t+b_\alpha)\right],
$$

正常正文 **仍然加粗**。

$$
o_t
=
W_o\left[\sigma(W_zx_t)\odot\operatorname{RMSNorm}(y_t)\right].
$$

| Operation | FLOPs |
|---|---:|
| Read | $d_kd_v$ |

[route](/src/_chat.$threadId.tsx)`);

    expect(markup.match(/class="katex-display"/g) ?? []).toHaveLength(2);
    expect(markup).not.toContain("katex-error");
    expect(markup).not.toMatch(/<h[12][ >]/);
    expect(markup).toContain("<strong>仍然加粗</strong>");
    expect(markup).toContain("<table>");
    expect(markup).toContain('href="/src/_chat.$threadId.tsx"');
  });

  it("preserves brackets inside inline math and ordinary prose beside links", async () => {
    const markup = await renderMarkdown(
      String.raw`[note] $x[0]+y[1]$ and $\left[f(x)\right]$; [route](/src/$id.tsx). Price $5.`,
    );

    expect(markup.match(/class="katex"/g) ?? []).toHaveLength(2);
    expect(markup).not.toContain("katex-error");
    expect(markup).toContain("[note]");
    expect(markup).toContain('href="/src/$id.tsx"');
    expect(markup).toContain("Price $5.");
  });

  it("keeps dollar signs in markdown file links from becoming math", async () => {
    const source =
      "Files touched:\n\n- [_chat.$threadId.tsx](/Users/julius/project/apps/web/src/routes/_chat.$threadId.tsx:1192)";
    const markup = await renderMarkdown(source, "/Users/julius/project");

    expect(markup).toContain(
      'href="/Users/julius/project/apps/web/src/routes/_chat.$threadId.tsx:1192"',
    );
    expect(markup).toContain("_chat.$threadId.tsx");
    expect(markup).not.toContain('class="katex"');
    expect(markup).not.toContain("CHATMARKDOWNLITERALDOLLARPLACEHOLDER");
  });

  it("keeps literal dollars before Markdown links", async () => {
    const markup = await renderMarkdown("Price $5/month; [plan](/pricing/$tier).");

    expect(markup).toContain("Price $5/month;");
    expect(markup).toContain('href="/pricing/$tier"');
    expect(markup).not.toContain('class="katex"');
  });

  it("keeps literal dollars before Markdown images without consuming their URLs", async () => {
    const markup = await renderMarkdown(
      "Use $ASSET for ![preview](https://example.com/assets/$variant.png).",
    );

    expect(markup).toContain("Use $ASSET for");
    expect(markup).toContain('src="https://example.com/assets/$variant.png"');
    expect(markup).not.toContain('class="katex"');
  });

  it("preserves bracketed TeX that also resembles a dollar-free Markdown link", async () => {
    const markup = await renderMarkdown("Math $[f](x)$ and $2[f](x)$.");

    expect(markup.match(/class="katex"/g) ?? []).toHaveLength(2);
    expect(markup).not.toContain("katex-error");
    expect(markup).not.toContain('href="x"');
  });

  it.each([
    ["$x[0]+y[", "$x[0]+y[1]$"],
    ["$$\n\\left[x[0]", "$$\n\\left[x[0]\\right]\n$$"],
  ])(
    "renders partial and completed bracketed formulas beside links: %s",
    async (partial, complete) => {
      const prefix = "Use $PATH and [route](/src/$id.tsx).\n\n";
      const partialMarkup = await renderMarkdown(prefix + partial);
      const completeMarkup = await renderMarkdown(prefix + complete + "\n\n**Still prose.**");

      expect(partialMarkup).not.toContain('class="katex"');
      expect(completeMarkup.match(/class="katex"/g) ?? []).toHaveLength(1);
      expect(completeMarkup).toContain("<strong>Still prose.</strong>");
      for (const markup of [partialMarkup, completeMarkup]) {
        expect(markup).toContain("Use $PATH and");
        expect(markup).toContain('href="/src/$id.tsx"');
        expect(markup).not.toContain("katex-error");
      }
    },
  );

  it("does not turn ordinary dollar text or escaped dollars into math", async () => {
    const markup = await renderMarkdown(
      "It costs $5 to $10 per seat. Escape \\$E=mc^2\\$ when you want literal TeX.",
    );

    expect(markup).toContain("$5 to $10");
    expect(markup).toContain("$E=mc^2$");
    expect(markup).not.toContain('class="katex"');
  });

  it("renders numeric expressions while keeping prices and code literal", async () => {
    const markup = await renderMarkdown(
      String.raw`Prices $5, $5 to $10, $5-$10 and $29.470. Math $2x$, $2.5x$, $2 + 3 = 5$, $2^{10}$ and $2\pi$.` +
        " Code `$2d_kd_v$`.",
    );
    expect(markup.match(/class="katex"/g) ?? []).toHaveLength(5);
    expect(markup).not.toContain("katex-error");
    expect(markup).toContain("$5 to $10");
    expect(markup).toContain("$5-$10");
    expect(markup).toContain("$29.470");
    expect(markup).toContain("<code>$2d_kd_v$</code>");
  });

  it("renders a table whose delimiter row is missing cells", async () => {
    const markup = await renderMarkdown(
      [
        "Advanced vs. normal mode:",
        "",
        "| | Normal mode | Advanced |",
        "|---|---|",
        "| Purpose | Focused, interactive work | Long-running, agent-led work |",
      ].join("\n"),
    );

    expect(markup).toContain("<table>");
    expect(markup).toContain("<th>Advanced</th>");
    expect(markup).toContain("<td>Purpose</td>");
    expect(markup).not.toContain("|---|");
  });

  it("keeps pipe-and-dash lines inside code fences out of table repair", async () => {
    const markup = await renderMarkdown(["```", "| a | b |", "|---|", "```"].join("\n"));

    expect(markup).not.toContain("<table>");
    expect(markup).toContain("|---|");
  });

  it("wraps in-thread find matches and records source offsets", async () => {
    const { default: ChatMarkdown } = await import("./ChatMarkdown");
    const markup = renderToStaticMarkup(
      <ChatMarkdown
        text="Error in src/app.ts and another error here."
        cwd={undefined}
        isStreaming={false}
        findQuery="error"
        findActiveRange={{ startOffset: 32, endOffset: 37 }}
      />,
    );
    expect(markup).toContain('data-chat-find-match="true"');
    expect(markup).toContain('data-chat-find-match="active"');
    expect(markup).toContain("chat-find-match-active");
    expect(markup).toContain('data-chat-find-start="0"');
    expect(markup).toContain('data-chat-find-start="32"');
  });

  it("keeps fenced-code find matches after the highlighter replaces children", async () => {
    const { default: ChatMarkdown } = await import("./ChatMarkdown");
    const markup = renderToStaticMarkup(
      <ChatMarkdown
        text={["```", "Error: command failed", "```"].join("\n")}
        cwd={undefined}
        isStreaming={false}
        findQuery="error"
      />,
    );
    expect(markup).toContain("chat-find-match");
    expect(markup).toContain("Error");
  });

  it("keeps active find offsets aligned inside inline file chips", async () => {
    const { default: ChatMarkdown } = await import("./ChatMarkdown");
    const text = "See `/tmp/error.ts` for details.";
    const startOffset = text.indexOf("error");
    const markup = renderToStaticMarkup(
      <ChatMarkdown
        text={text}
        cwd={undefined}
        isStreaming={false}
        findQuery="error"
        findActiveRange={{ startOffset, endOffset: startOffset + "error".length }}
      />,
    );

    expect(markup).toContain('data-chat-find-match="active"');
    expect(markup).toContain(`data-chat-find-start="${String(startOffset)}"`);
    expect(markup).toContain(">error</span>");
  });

  it("joins a relative chip onto a directory declared in the same message", async () => {
    const markup = await renderMarkdown(
      [
        "**Dir:** `/Users/tester/.agents/skills/annotate-pr`",
        "",
        "- `scripts/delete_uploadthing.py`",
      ].join("\n"),
      "/Users/tester/Documents/Glade/thread",
    );

    expect(markup).toContain(
      'title="/Users/tester/.agents/skills/annotate-pr/scripts/delete_uploadthing.py"',
    );
    expect(markup).not.toContain(
      'href="/Users/tester/Documents/Glade/thread/scripts/delete_uploadthing.py"',
    );
  });

  it("chips a line-suffixed relative file against a directory declared in the same message", async () => {
    const markup = await renderMarkdown(
      ["**Dir:** `/Users/tester/.agents/skills/annotate-pr`", "", "- `SKILL.md:1`"].join("\n"),
      "/Users/tester/Documents/Glade/thread",
    );

    expect(markup).toContain('title="/Users/tester/.agents/skills/annotate-pr/SKILL.md"');
    expect(markup).not.toContain('href="/Users/tester/Documents/Glade/thread/SKILL.md"');
  });
});

describe("ChatMarkdown user variant", () => {
  it("keeps dollars literal instead of parsing math", async () => {
    const markup = await renderUserMarkdown("It costs $5 and $x^2$ stays literal.");

    expect(markup).toContain("$5");
    expect(markup).toContain("$x^2$");
    expect(markup).not.toContain('class="katex"');
  });

  it("keeps composer tokens literal inside inline code", async () => {
    const markup = await renderUserMarkdown("literal `$deep-research` here");

    expect(markup).toContain("<code>$deep-research</code>");
    expect(markup).not.toContain("Deep Research");
  });

  it("keeps Object.prototype member names as literal inline code", async () => {
    for (const token of ["constructor", "__proto__", '"constructor"', '"__proto__"']) {
      const markup = await renderUserMarkdown(`what if a key is \`${token}\``);

      expect(markup).toContain("<code>");
      expect(markup).not.toContain('data-slot="central-icon"');
    }
  });
});

it("opens Obsidian aliases relative to the vault and leaves code unchanged", async () => {
  const { default: ChatMarkdown } = await import("./ChatMarkdown");
  const markup = renderWithQueryClient(
    <ChatMarkdown
      text={
        "Read [[03-Resources/papers/Qwen-3.8-Flash-Next.pdf|论文]] and [[My note]]. Code `[[literal|text]]`."
      }
      cwd="/vault/02-Areas/Career"
      wikiLinkRoot="/vault"
    />,
  );
  expect(markup).toContain('href="/vault/03-Resources/papers/Qwen-3.8-Flash-Next.pdf"');
  expect(markup).toContain("论文");
  expect(markup).toContain('href="/vault/My%20note.md"');
  expect(markup).toContain("<code>[[literal|text]]</code>");
  expect(markup).not.toContain("[[03-Resources");
});

it.each(["\n", "\r\n"])(
  "keeps wiki links on the first line of a GitHub alert (%j)",
  async (eol) => {
    const { default: ChatMarkdown } = await import("./ChatMarkdown");
    const markup = renderWithQueryClient(
      <ChatMarkdown
        text={`> [!NOTE]${eol}> See [[My note]] now`}
        cwd="/vault"
        wikiLinkRoot="/vault"
      />,
    );
    expect(markup).toContain('data-github-alert="note"');
    expect(markup).toContain('href="/vault/My%20note.md"');
    expect(markup).not.toContain("[[My note]]");
  },
);

describe("workspace Wiki links", () => {
  it.each([
    ["/vault/root #1", "/vault/root%20%231/My%20%2520%20note.md", "/vault/root #1/My %20 note.md"],
    [
      "C:\\Users\\me\\vault",
      "C:/Users/me/vault/My%20%2520%20note.md",
      "C:/Users/me/vault/My %20 note.md",
    ],
    [
      "\\\\server\\share\\vault",
      "//server/share/vault/My%20%2520%20note.md",
      "//server/share/vault/My %20 note.md",
    ],
  ])("opens encoded file paths under %s", async (root, href, target) => {
    const { default: ChatMarkdown } = await import("./ChatMarkdown");
    const markup = renderWithQueryClient(
      <ChatMarkdown text="[[My %20 note|Read note]]" cwd={root} wikiLinkRoot={root} />,
    );
    expect(markup).toContain(`href="${href}"`);
    expect(markup).toContain(`title="${target}"`);
    expect(markup).not.toContain('target="_blank"');
  });

  it.each([
    "Before [[note|Alias]] after",
    "Escaped \\* and &amp; Before [[note]] after",
    "First line\r\nBefore [[note]] after",
    "> First line\r\n> [[note]] after",
    "> [!TIP]\r\n>   Before [[note]] after",
    "- First line\n  [[note]] after",
    "[[note]] &amp; \\* after",
    "[[note|Label &amp; after]]",
    "Cost \\$5 [[note]] after",
  ])("keeps find source offsets in %s", async (text) => {
    const { default: ChatMarkdown } = await import("./ChatMarkdown");
    const startOffset = text.indexOf("after");
    const markup = renderWithQueryClient(
      <ChatMarkdown
        text={text}
        cwd="/vault"
        findQuery="after"
        findActiveRange={{ startOffset, endOffset: startOffset + 5 }}
      />,
    );
    expect(markup).toContain(`data-chat-find-start="${startOffset}"`);
    expect(markup).toContain('data-chat-find-match="active"');
  });

  it("leaves escaped syntax, embeds, and unsupported headings literal", async () => {
    const markup = await renderMarkdown(
      "\\[\\[escaped]] ![[embed]] [[note#Heading]] [[#Heading]] `[[code]]`",
      "/vault",
    );
    expect(markup).toContain("[[escaped]]");
    expect(markup).toContain("![[embed]]");
    expect(markup).toContain("[[note#Heading]]");
    expect(markup).not.toContain("href=");
  });
});

it.each(["> First line\n> [[note|Read note]] after", "- First line\n  [[note|Read note]] after"])(
  "opens Wiki links on Markdown continuation lines: %s",
  async (text) => {
    const markup = await renderMarkdown(text, "/vault");
    expect(markup).toContain('href="/vault/note.md"');
    expect(markup).toContain("Read note");
  },
);

it("keeps dollar filenames separate from math and rejects escaped delimiters", async () => {
  const text = String.raw`Use $PATH: [[notes/$threadId.tsx|Route]]. Formula $2x[0]$; \[\[literal\]\]. [[foo\]] [[note\|alias]]`;
  const markup = await renderMarkdown(text, "/vault");
  expect(markup).toContain('href="/vault/notes/$threadId.tsx"');
  expect(markup.match(/class="katex"/g)).toHaveLength(1);
  expect(markup).toContain("[[literal]]");
  expect(markup).not.toContain("foo.md");
  expect(markup).not.toContain("alias.md");
  expect(markup.match(/<a\b[^>]*\bhref=/g)).toHaveLength(1);
});
