import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import ChatMarkdown from "./ChatMarkdown";

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

function renderMarkdown(text: string, cwd = "C:\\Users\\LENOVO\\glade") {
  return renderWithQueryClient(<ChatMarkdown text={text} cwd={cwd} isStreaming={false} />);
}

function renderUserMarkdown(text: string) {
  return renderWithQueryClient(
    <ChatMarkdown text={text} cwd={undefined} isStreaming={false} variant="user" />,
  );
}

describe("ChatMarkdown", () => {
  it.each([
    {
      name: "inline in a paragraph",
      text: "One<br>two<BR/>three",
      expected: "<p>One<br/>\ntwo<br/>\nthree</p>",
    },
    {
      name: "inside a table cell",
      text: "| a |\n| - |\n| x<br />y |",
      expected: "<td>x<br/>\ny</td>",
    },
    {
      name: "alone between blocks",
      text: "Before.\n\n<br>\n\nAfter.",
      expected: "<p>Before.</p>\n<p>After.</p>",
    },
    { name: "in a code span", text: "Use `<br>` here.", expected: "<code>&lt;br&gt;</code>" },
    { name: "in a code fence", text: "```\n<br />\n```", expected: "&lt;br /&gt;" },
    {
      name: "only as the exact tag",
      text: 'a<br class="x">b',
      expected: "<p>a&lt;br class=&quot;x&quot;&gt;b</p>",
    },
  ])("renders <br> tags safely $name", ({ text, expected }) => {
    expect(renderMarkdown(text)).toContain(expected);
  });

  it("keeps links and code intact when math is present", () => {
    const markup = renderMarkdown(
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

  it("keeps bracketed display formulas intact without swallowing subsequent prose and tables", () => {
    const markup = renderMarkdown(String.raw`- **Decay gate**:

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

  it.each<{
    name: string;
    text: string;
    cwd?: string;
    katex: number;
    contains: string[];
    absent?: string[];
  }>([
    {
      name: "preserves brackets inside inline math and ordinary prose beside links",
      text: String.raw`[note] $x[0]+y[1]$ and $\left[f(x)\right]$; [route](/src/$id.tsx). Price $5.`,
      katex: 2,
      contains: ["[note]", 'href="/src/$id.tsx"', "Price $5."],
    },
    {
      name: "keeps dollar signs in markdown file links from becoming math",
      text: "Files touched:\n\n- [_chat.$threadId.tsx](/Users/julius/project/apps/web/src/routes/_chat.$threadId.tsx:1192)",
      cwd: "/Users/julius/project",
      katex: 0,
      contains: [
        'href="/Users/julius/project/apps/web/src/routes/_chat.$threadId.tsx:1192"',
        "_chat.$threadId.tsx",
      ],
      absent: ["CHATMARKDOWNLITERALDOLLARPLACEHOLDER"],
    },
    {
      name: "keeps literal dollars before Markdown links",
      text: "Price $5/month; [plan](/pricing/$tier).",
      katex: 0,
      contains: ["Price $5/month;", 'href="/pricing/$tier"'],
    },
    {
      name: "keeps literal dollars before Markdown images without consuming their URLs",
      text: "Use $ASSET for ![preview](https://example.com/assets/$variant.png).",
      katex: 0,
      contains: ["Use $ASSET for", 'src="https://example.com/assets/$variant.png"'],
    },
    {
      name: "preserves bracketed TeX that also resembles a dollar-free Markdown link",
      text: "Math $[f](x)$ and $2[f](x)$.",
      katex: 2,
      contains: [],
      absent: ['href="x"'],
    },
    {
      name: "does not turn ordinary dollar text or escaped dollars into math",
      text: "It costs $5 to $10 per seat. Escape \\$E=mc^2\\$ when you want literal TeX.",
      katex: 0,
      contains: ["$5 to $10", "$E=mc^2$"],
    },
    {
      name: "renders numeric expressions while keeping prices and code literal",
      text:
        String.raw`Prices $5, $5 to $10, $5-$10 and $29.470. Math $2x$, $2.5x$, $2 + 3 = 5$, $2^{10}$ and $2\pi$.` +
        " Code `$2d_kd_v$`.",
      katex: 5,
      contains: ["$5 to $10", "$5-$10", "$29.470", "<code>$2d_kd_v$</code>"],
    },
  ])("$name", ({ text, cwd, katex, contains, absent = [] }) => {
    const markup = renderMarkdown(text, cwd);

    expect(markup.match(/class="katex"/g) ?? []).toHaveLength(katex);
    expect(markup).not.toContain("katex-error");
    for (const fragment of contains) expect(markup).toContain(fragment);
    for (const fragment of absent) expect(markup).not.toContain(fragment);
  });

  it.each([
    ["$x[0]+y[", "$x[0]+y[1]$"],
    ["$$\n\\left[x[0]", "$$\n\\left[x[0]\\right]\n$$"],
  ])("renders partial and completed bracketed formulas beside links: %s", (partial, complete) => {
    const prefix = "Use $PATH and [route](/src/$id.tsx).\n\n";
    const partialMarkup = renderMarkdown(prefix + partial);
    const completeMarkup = renderMarkdown(prefix + complete + "\n\n**Still prose.**");

    expect(partialMarkup).not.toContain('class="katex"');
    expect(completeMarkup.match(/class="katex"/g) ?? []).toHaveLength(1);
    expect(completeMarkup).toContain("<strong>Still prose.</strong>");
    for (const markup of [partialMarkup, completeMarkup]) {
      expect(markup).toContain("Use $PATH and");
      expect(markup).toContain('href="/src/$id.tsx"');
      expect(markup).not.toContain("katex-error");
    }
  });

  it("renders a table whose delimiter row is missing cells", () => {
    const markup = renderMarkdown(
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

  it("keeps pipe-and-dash lines inside code fences out of table repair", () => {
    const markup = renderMarkdown(["```", "| a | b |", "|---|", "```"].join("\n"));

    expect(markup).not.toContain("<table>");
    expect(markup).toContain("|---|");
  });

  it("wraps in-thread find matches and records source offsets", () => {
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

  it("keeps fenced-code find matches after the highlighter replaces children", () => {
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

  it.each([
    ["scripts/delete_uploadthing.py", "scripts/delete_uploadthing.py"],
    ["SKILL.md:1", "SKILL.md"],
  ])(
    "resolves the relative chip %s against a directory declared in the same message",
    (chip, path) => {
      const markup = renderMarkdown(
        ["**Dir:** `/Users/tester/.agents/skills/annotate-pr`", "", `- \`${chip}\``].join("\n"),
        "/Users/tester/Documents/Glade/thread",
      );

      expect(markup).toContain(`title="/Users/tester/.agents/skills/annotate-pr/${path}"`);
      expect(markup).not.toContain(`href="/Users/tester/Documents/Glade/thread/${path}"`);
    },
  );
});

describe("ChatMarkdown user variant", () => {
  it("keeps dollars literal instead of parsing math", () => {
    const markup = renderUserMarkdown("It costs $5 and $x^2$ stays literal.");

    expect(markup).toContain("$5");
    expect(markup).toContain("$x^2$");
    expect(markup).not.toContain('class="katex"');
  });

  it("keeps composer tokens literal inside inline code", () => {
    const markup = renderUserMarkdown("literal `$deep-research` here");

    expect(markup).toContain("<code>$deep-research</code>");
    expect(markup).not.toContain("Deep Research");
  });

  it("keeps Object.prototype member names as literal inline code", () => {
    for (const token of ["constructor", "__proto__", '"constructor"', '"__proto__"']) {
      const markup = renderUserMarkdown(`what if a key is \`${token}\``);

      expect(markup).toContain("<code>");
      expect(markup).not.toContain('data-slot="central-icon"');
    }
  });
});

describe("workspace Wiki links", () => {
  it.each([
    {
      name: "Obsidian aliases relative to the vault while code stays literal",
      text: "Read [[03-Resources/papers/Qwen-3.8-Flash-Next.pdf|论文]] and [[My note]]. Code `[[literal|text]]`.",
      cwd: "/vault/02-Areas/Career",
      contains: [
        'href="/vault/03-Resources/papers/Qwen-3.8-Flash-Next.pdf"',
        "论文",
        'href="/vault/My%20note.md"',
        "<code>[[literal|text]]</code>",
      ],
      absent: ["[[03-Resources"],
    },
    ...["\n", "\r\n"].map((eol) => ({
      name: `the first line of a GitHub alert (${JSON.stringify(eol)})`,
      text: `> [!NOTE]${eol}> See [[My note]] now`,
      cwd: "/vault",
      contains: ['data-github-alert="note"', 'href="/vault/My%20note.md"'],
      absent: ["[[My note]]"],
    })),
    ...["> First line\n> [[note|Read note]] after", "- First line\n  [[note|Read note]] after"].map(
      (text) => ({
        name: `a Markdown continuation line: ${JSON.stringify(text)}`,
        text,
        cwd: "/vault",
        contains: ['href="/vault/note.md"', "Read note"],
        absent: [],
      }),
    ),
  ])("opens wiki links in $name", ({ text, cwd, contains, absent }) => {
    const markup = renderWithQueryClient(
      <ChatMarkdown text={text} cwd={cwd} wikiLinkRoot="/vault" />,
    );
    for (const fragment of contains) expect(markup).toContain(fragment);
    for (const fragment of absent) expect(markup).not.toContain(fragment);
  });

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
  ])("opens encoded file paths under %s", (root, href, target) => {
    const markup = renderWithQueryClient(
      <ChatMarkdown text="[[My %20 note|Read note]]" cwd={root} wikiLinkRoot={root} />,
    );
    expect(markup).toContain(`href="${href}"`);
    expect(markup).toContain(`title="${target}"`);
    expect(markup).not.toContain('target="_blank"');
  });

  it.each([
    "See `/tmp/after.ts` for details.",
    "Before [[note|Alias]] after",
    "Escaped \\* and &amp; Before [[note]] after",
    "First line\r\nBefore [[note]] after",
    "> First line\r\n> [[note]] after",
    "> [!TIP]\r\n>   Before [[note]] after",
    "- First line\n  [[note]] after",
    "[[note]] &amp; \\* after",
    "[[note|Label &amp; after]]",
    "Cost \\$5 [[note]] after",
  ])("keeps find source offsets in %s", (text) => {
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

  it("leaves escaped syntax, embeds, and unsupported headings literal", () => {
    const markup = renderMarkdown(
      "\\[\\[escaped]] ![[embed]] [[note#Heading]] [[#Heading]] `[[code]]`",
      "/vault",
    );
    expect(markup).toContain("[[escaped]]");
    expect(markup).toContain("![[embed]]");
    expect(markup).toContain("[[note#Heading]]");
    expect(markup).not.toContain("href=");
  });
});

it("keeps dollar filenames separate from math and rejects escaped delimiters", () => {
  const text = String.raw`Use $PATH: [[notes/$threadId.tsx|Route]]. Formula $2x[0]$; \[\[literal\]\]. [[foo\]] [[note\|alias]]`;
  const markup = renderMarkdown(text, "/vault");
  expect(markup).toContain('href="/vault/notes/$threadId.tsx"');
  expect(markup.match(/class="katex"/g)).toHaveLength(1);
  expect(markup).toContain("[[literal]]");
  expect(markup).not.toContain("foo.md");
  expect(markup).not.toContain("alias.md");
  expect(markup.match(/<a\b[^>]*\bhref=/g)).toHaveLength(1);
});
