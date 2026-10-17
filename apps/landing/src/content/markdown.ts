import {
  agents,
  DOCS_URL,
  BREW_COMMAND,
  chapters,
  faq,
  features,
  installers,
  meta,
  RELEASES_URL,
  REPO_URL,
  SITE_URL,
} from "./site";

// Generated from the same content as the page, so the Markdown copy and llms.txt never drift.

const RAW_DOCS = "https://raw.githubusercontent.com/berkinory/Glade/main";
const line = (parts: ReadonlyArray<string>) => parts.join(" ");
const bullets = (items: ReadonlyArray<string>) => items.map((item) => `- ${item}`).join("\n");

const facts: ReadonlyArray<[string, string]> = [
  ["What it is", "A desktop app that runs several coding-agent CLIs side by side"],
  ["Agents", agents.map((agent) => agent.name).join(", ")],
  ["Platforms", "macOS (Apple Silicon and Intel), Windows x64, Linux x86_64 (AppImage)"],
  ["Price", "Free"],
  ["License", "MIT, open source"],
  ["Account", "None; it uses the agent CLIs you already signed in to"],
  ["Where it runs", "Locally; chats, history and connector sign-ins stay on your machine"],
];

const installLines = [
  ...installers.map(
    (installer) => `- ${installer.platform} ${installer.variant}: ${installer.url}`,
  ),
  `- Homebrew (macOS): \`${BREW_COMMAND}\``,
  `- All releases and checksums: ${RELEASES_URL}`,
];

function section(title: ReadonlyArray<string>, body: string, items: ReadonlyArray<string>) {
  return `## ${line(title)}\n\n${body}\n\n${bullets(items)}`;
}

// The whole landing page as Markdown, for agents that read text rather than layout.
export function pageMarkdown(): string {
  const { shared, computer, machines, features: built } = chapters;
  return `# Glade

> ${meta.summary}

| | |
| --- | --- |
${facts.map(([key, value]) => `| ${key} | ${value} |`).join("\n")}

## Install

${installLines.join("\n")}

After installing, Glade finds the agent CLIs on your machine. Install and sign in to at least one of them first.

## Supported agents

Glade does not host models or sell a subscription. It drives these CLIs with your own accounts and plans:

${bullets(agents.map((agent) => `**${agent.name}**: ${agent.runtime}`))}

${section(
  shared.title,
  shared.body,
  shared.points.map((point) => `**${point.title}.** ${point.body}`),
)}

${section(
  computer.title,
  computer.body,
  computer.points.map((point) => `**${point.title}.** ${point.body}`),
)}

${section(machines.title, machines.body, machines.details)}

${section(
  built.title,
  built.body,
  features.map((feature) => `**${feature.title}.** ${feature.body}`),
)}

## Frequently asked questions

${faq.map((item) => `### ${item.question}\n\n${item.answer}`).join("\n\n")}

## Links

- Website: ${SITE_URL}/
- Source code: ${REPO_URL}
- Documentation: ${DOCS_URL}
- Changelog: ${REPO_URL}/blob/main/CHANGELOG.md
`;
}

// llms.txt, following the llmstxt.org v2 layout: a title, a summary, key facts, then link lists that
// point at Markdown an agent can read directly.
export function llmsIndex(): string {
  const doc = (path: string, title: string, note: string) =>
    `- [${title}](${RAW_DOCS}/${path}): ${note}`;
  return `# Glade

> ${meta.summary}

${bullets(facts.map(([key, value]) => `${key}: ${value}`))}

Typical uses: running several coding agents in one window, sharing skills and MCP servers between Claude Code, Codex and Cursor, handing a task from one agent to another, letting an agent operate a desktop app, and running agents on SSH hosts.

## Product

- [Glade overview](${SITE_URL}/index.md): features, supported agents, install links and FAQ in one page

## Install

${[
  ...installers.map(
    (installer) =>
      `- [${installer.platform} ${installer.variant}](${installer.url}): always the latest release`,
  ),
  `- [All releases](${RELEASES_URL}): every installer with SHA-256 checksums; Homebrew: \`${BREW_COMMAND}\``,
].join("\n")}

## Documentation

${[
  `- [Glade docs](${DOCS_URL}): guides and reference for every feature`,
  doc("README.md", "README", "install on every platform and run from source"),
  doc("docs/quickstart.md", "Quickstart", "first project, first chat and the main surfaces"),
  doc("docs/providers.md", "Supported agents", "required CLI versions and what Glade manages"),
  doc("docs/core-concepts.md", "Core concepts", "projects, tasks, handoffs, Git and checkpoints"),
  doc("docs/connectors.md", "MCP connectors", "connect a service once for every agent"),
  doc("docs/ssh-hosts.md", "SSH hosts", "run chats and agents on another machine"),
  doc("docs/REMOTE.md", "Remote access", "pair devices and other computers"),
  doc("docs/KEYBINDINGS.md", "Keyboard shortcuts", "default bindings and how to change them"),
].join("\n")}

## Optional

${[
  doc("CHANGELOG.md", "Changelog", "what changed in each release"),
  doc(
    "docs/glade-feature-scope.md",
    "Feature scope",
    "what Glade does and deliberately does not do",
  ),
  `- [Full text](${SITE_URL}/llms-full.txt): the overview page in a single file`,
].join("\n")}
`;
}
