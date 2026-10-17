// The page, its Markdown copy, llms.txt and the structured data all read from here, so what people
// and agents see cannot drift apart.

import type { ProviderKind } from "@glade/contracts/core/baseSchemas";

export const SITE_URL = "https://useglade.dev";
export const REPO_URL = "https://github.com/berkinory/Glade";
export const RELEASES_URL = `${REPO_URL}/releases/latest`;
export const DOCS_URL = "https://docs.useglade.dev";
export const BREW_COMMAND = "brew install --cask berkinory/brew/glade";

export type InstallerId = "macArm" | "macIntel" | "windows" | "linux";

// Every release publishes versionless copies of its installers, so these always fetch the newest.
const latestDownload = (file: string) => `${REPO_URL}/releases/latest/download/${file}`;

export type OsLogoName = "apple" | "windows" | "linux";

export const installers: ReadonlyArray<{
  id: InstallerId;
  platform: string;
  variant: string;
  logo: OsLogoName;
  url: string;
}> = [
  {
    id: "macArm",
    platform: "macOS",
    variant: "Apple Silicon",
    logo: "apple",
    url: latestDownload("Glade-macOS-arm64.dmg"),
  },
  {
    id: "macIntel",
    platform: "macOS",
    variant: "Intel",
    logo: "apple",
    url: latestDownload("Glade-macOS-x64.dmg"),
  },
  {
    id: "windows",
    platform: "Windows",
    variant: "x64",
    logo: "windows",
    url: latestDownload("Glade-Windows-x64.exe"),
  },
  {
    id: "linux",
    platform: "Linux",
    variant: "AppImage",
    logo: "linux",
    url: latestDownload("Glade-Linux-x86_64.AppImage"),
  },
];

export const meta = {
  title: "Glade · All-in-one agentic workspace",
  description:
    "Glade is a free, open-source desktop workspace for coding agents. Run Claude Code, Codex, Cursor and more side by side.",
  summary:
    "Glade is a free, MIT-licensed desktop app for macOS, Windows and Linux that runs the coding agents you already use (Claude Code, Codex, Cursor, Grok Build and OpenCode) side by side in one window on your own machine.",
};

// Keyed by the provider registry, so a new provider fails the type check until it is described here.
const agentDetails: Record<ProviderKind, { name: string; runtime: string }> = {
  claudeAgent: { name: "Claude Code", runtime: "Claude Code 2.1.267 or newer" },
  codex: { name: "Codex", runtime: "Codex CLI 0.158.0 or newer" },
  cursor: { name: "Cursor", runtime: "Cursor CLI 2026.1.0 or newer" },
  grok: { name: "Grok Build", runtime: "Grok Build 1.0.0 or newer" },
  opencode: { name: "OpenCode", runtime: "OpenCode 2.0.0 or newer" },
};

export const agents = (Object.keys(agentDetails) as ProviderKind[]).map((id) => ({
  id,
  ...agentDetails[id],
}));

export const hero = {
  title: ["One workspace for", "every coding agent."],
  lead: "Claude Code, Codex, Cursor, Grok and OpenCode side by side, with the skills, servers and machines they share. Bring the subscriptions you already have.",
};

export const agentsBand = {
  eyebrow: "Bring the agents you already pay for",
  note: "Glade drives the CLIs you've already installed and signed in to. Your plans, your limits, no Glade account.",
};

export interface Point {
  icon: IconName;
  title: string;
  body: string;
}

export type IconName =
  | "book"
  | "plug"
  | "layers"
  | "pointer"
  | "shield"
  | "pause"
  | "globe"
  | "handoff"
  | "fork"
  | "undo"
  | "pullRequest"
  | "window"
  | "chart"
  | "gauge"
  | "laptop"
  | "home"
  | "key"
  | "scale"
  | "copy"
  | "check"
  | "github"
  | "play"
  | "chevronDown";

export const chapters = {
  shared: {
    numeral: "I",
    label: "Skills and MCP servers",
    title: ["Set it up once.", "Every agent gets it."],
    body: "Add a skill or connect an MCP server one time. Glade hands the same copy to Claude Code, Codex, Cursor, Grok and OpenCode, and your sign-ins never leave this computer.",
    points: [
      {
        icon: "book",
        title: "Skills, checked before they land",
        body: "Install from skills.sh or GitHub after a look at the source and scripts, then share it with every agent in one switch.",
      },
      {
        icon: "plug",
        title: "One sign-in per service",
        body: "Connect Linear, Supabase or Context7 once. Agents use the tools and never see the token.",
      },
      {
        icon: "layers",
        title: "Your choice, per agent",
        body: "Share everything, or pick which agents get each skill and server. Agents you add later inherit the set.",
      },
    ] satisfies Point[],
  },
  computer: {
    numeral: "II",
    label: "Computer Use",
    title: ["Hands, not", "just words."],
    body: "When you ask, an agent can work in the apps on your desktop with a cursor of its own. You watch every step, and Stop is always one click away.",
    caption:
      "An agent fills in a New release form in a desktop app with its own labelled cursor: it types the version, picks the Beta channel, writes the release notes, turns on notifications and publishes.",
    points: [
      {
        icon: "pointer",
        title: "Its own cursor",
        body: "The agent clicks, types and scrolls in the app you named, with a labelled cursor you can always tell apart from yours.",
      },
      {
        icon: "shield",
        title: "Permission is explicit",
        body: "Each app needs your grant: read, act or full control. Grants end when Glade quits.",
      },
      {
        icon: "globe",
        title: "A browser of its own",
        body: "Agents also drive a built-in browser with tabs per chat and your sign-ins, so web tasks never leave the window.",
      },
    ] satisfies Point[],
  },
  machines: {
    numeral: "III",
    label: "SSH hosts and remote",
    title: ["Wherever", "the code lives."],
    body: "Add a server from your SSH config and its projects join your sidebar. Pair with another computer's Glade and drive it from here. Chats and agents run over there; the window stays with you.",
    details: [
      "Linux and macOS hosts over your own ssh",
      "Glade installs and updates its server there",
      "Each machine brings its own agents",
    ],
  },
  features: {
    numeral: "IV",
    label: "Built in",
    title: ["The rest of the job,", "already handled."],
    body: "Everything between the prompt and the merge: parallel work, rewinds, reviews and limits. Local, open source, and running on the plans you already pay for.",
  },
} as const;

export const features: ReadonlyArray<Point & { core?: boolean }> = [
  {
    icon: "handoff",
    title: "Handoffs",
    body: "Switch agents mid-task. The chat, plan and files come along.",
  },
  { icon: "fork", title: "Worktrees", body: "Parallel tasks, each in its own checkout." },
  { icon: "undo", title: "Checkpoints", body: "Rewind to any message, keep or restore files." },
  { icon: "pullRequest", title: "Pull requests", body: "Commit, push and open the PR in place." },
  {
    icon: "window",
    title: "Environment panel",
    body: "Branch, servers, usage and editor at a glance.",
  },
  { icon: "chart", title: "Visual replies", body: "Answers as charts, stats and tables." },
  { icon: "gauge", title: "Usage limits", body: "Session and weekly limits for every agent." },
  { icon: "laptop", title: "Cross-platform", body: "macOS, Windows and Linux." },
  {
    icon: "home",
    title: "Runs locally",
    body: "The server, chats and history live on your machine.",
    core: true,
  },
  {
    icon: "key",
    title: "Your subscriptions",
    body: "Drives the agents you already pay for. No Glade account.",
    core: true,
  },
  {
    icon: "shield",
    title: "Sign-ins stay home",
    body: "Connector tokens sit in a private file agents never see.",
    core: true,
  },
  {
    icon: "scale",
    title: "MIT licensed",
    body: "Read every line, build it yourself, fork it.",
    core: true,
  },
];

export const faq: ReadonlyArray<{ question: string; answer: string }> = [
  {
    question: "What is Glade?",
    answer:
      "Glade is a free, open-source desktop app for working with coding agents. It runs Claude Code, Codex, Cursor, Grok Build and OpenCode in one window, with shared projects, terminals, diffs, Git and settings.",
  },
  {
    question: "Does Glade cost anything or need an account?",
    answer:
      "No. Glade is free and MIT licensed, and it has no account of its own. It drives the agent CLIs you have already installed and signed in to, so your usage counts against the plans you already have.",
  },
  {
    question: "Which coding agents does Glade support?",
    answer: `${agents.map((agent) => agent.runtime).join(", ")}.`,
  },
  {
    question: "Where do my code and chats live?",
    answer:
      "On your computer. Glade's server runs locally and keeps chats, history and connector sign-ins there. Each agent still talks to its own model provider, exactly as it does in your terminal.",
  },
  {
    question: "Can agents work on another machine?",
    answer:
      "Yes. Add a Linux or macOS host from your SSH config and its projects appear in the sidebar; Glade installs its server there. You can also pair with another computer's Glade and use its projects from your own window.",
  },
  {
    question: "Which platforms can I install it on?",
    answer:
      "macOS on Apple Silicon and Intel, Windows x64 and Linux x64 as an AppImage. On macOS you can also install it with Homebrew.",
  },
];

export const finalCta = {
  title: ["Bring every agent", "into the clearing."],
  body: "Free and open source. Install it, point it at the agents you already use, and start in about a minute.",
};

export const footerLinks: ReadonlyArray<{
  heading: string;
  links: ReadonlyArray<[string, string]>;
}> = [
  {
    heading: "Product",
    links: [
      ["Download", RELEASES_URL],
      ["Changelog", `${REPO_URL}/blob/main/CHANGELOG.md`],
      ["Documentation", DOCS_URL],
      ["Supported agents", `${REPO_URL}/blob/main/docs/providers.md`],
    ],
  },
  {
    heading: "Project",
    links: [
      ["GitHub", REPO_URL],
      ["Releases", `${REPO_URL}/releases`],
      ["Security", `${REPO_URL}/blob/main/SECURITY.md`],
      ["License", `${REPO_URL}/blob/main/LICENSE`],
    ],
  },
  {
    heading: "For agents",
    links: [
      ["LLMs.txt", "/llms.txt"],
      ["Markdown", "/index.md"],
    ],
  },
];
