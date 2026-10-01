import type { LucideIcon } from "~/lib/icons";
import { BotIcon, GitBranchIcon, GitPullRequestIcon, GlobeIcon, KeyboardIcon } from "~/lib/icons";

const GLADE_DOCS_URL = "https://github.com/berkinory/Glade/blob/main/docs";

export interface TourCard {
  readonly id: string;

  readonly label: string;
  readonly title: string;
  readonly description: string;
  readonly highlights: ReadonlyArray<string>;
  readonly docsHref: string;
  readonly icon: LucideIcon;
}

export const TOUR_CARDS: ReadonlyArray<TourCard> = [
  {
    id: "agents",
    label: "Any agent",
    title: "Run every coding agent in one workspace",
    description:
      "Glade sits around the agent runtimes you already trust: Claude Code and Codex. The provider keeps its account, models, and limits. Glade owns the durable task, environment, transcript, and delivery workflow around it.",
    highlights: [
      "Switch models mid-thread",
      "Hand a thread to another provider",
      "Usage for every provider",
    ],
    docsHref: `${GLADE_DOCS_URL}/providers.md`,
    icon: BotIcon,
  },
  {
    id: "tasks",
    label: "Tasks & worktrees",
    title: "One task, one isolated environment",
    description:
      "Each task owns one body of work: its conversation, provider session, working environment, tool activity, and Git changes. Run tasks in parallel on managed Git worktrees so two agents never edit the same checkout.",
    highlights: ["Managed worktrees", "Forks from any message", "Subagents and split views"],
    docsHref: `${GLADE_DOCS_URL}/core-concepts.md`,
    icon: GitBranchIcon,
  },
  {
    id: "review",
    label: "Review & PRs",
    title: "From objective to evidence",
    description:
      "A task is complete only after you understand and verify its result, not when the provider reports it is finished. Inspect diffs, run terminals, then commit, push, and open a pull request without leaving the workspace.",
    highlights: [
      "Turn changes and Git history in Source Control",
      "Commit → push → PR",
      "Native pull-request workspace",
    ],
    docsHref: `${GLADE_DOCS_URL}/quickstart.md`,
    icon: GitPullRequestIcon,
  },
  {
    id: "browser",
    label: "Browser",
    title: "Verify in a real browser",
    description: "Agents drive a visible, task-owned browser you can watch and annotate.",
    highlights: ["Shared Chromium surface", "Element annotations"],
    docsHref: `${GLADE_DOCS_URL}/core-concepts.md`,
    icon: GlobeIcon,
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    title: "Keep your hands on the keyboard",
    description:
      "Everything in the workspace has a shortcut, and the keymap is editable from Settings. A few worth learning on day one:",
    highlights: [],
    docsHref: `${GLADE_DOCS_URL}/KEYBINDINGS.md`,
    icon: KeyboardIcon,
  },
];

export const TOUR_SHORTCUT_COMMANDS = [
  { command: "chat.new", label: "New task" },
  { command: "sidebar.addProject", label: "Add project" },
  { command: "sidebar.search", label: "Search sidebar" },
  { command: "terminal.toggle", label: "Toggle terminal" },
  { command: "diff.toggle", label: "Toggle diff" },
] as const;
