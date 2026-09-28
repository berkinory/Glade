import type { WhatsNewEntry } from "./logic";

export const WHATS_NEW_ENTRIES: readonly WhatsNewEntry[] = [
  {
    version: "0.0.4",
    date: "2026-09-28",
    features: [
      {
        id: "studio-retired",
        title: "Removed",
        description: "Studio mode and its dedicated workspace flows are gone.",
        commit: "648d50fb1194ffe60e273cf07407231eb6e5d910",
      },
      {
        id: "handoff-controls-retired",
        title: "Removed",
        description: "Separate provider and new-worktree handoff controls are gone.",
        commit: "177bf808538d03182e0368fc02151debdfd559ed",
      },
      {
        id: "provider-switching",
        title: "Improved",
        description:
          "Switch providers from the model picker with confirmation and a visible transition in the new chat.",
        commit: "177bf808538d03182e0368fc02151debdfd559ed",
      },
      {
        id: "desktop-updates",
        title: "Improved",
        description: "Check, download, and install desktop updates from Settings.",
        commit: "14381fb8cb07f16cdd725fe7177760d674ef268d",
      },
      {
        id: "picker-menus",
        title: "Improved",
        description: "Branch and project pickers use compact menus.",
        commit: "341bd13f8b43d4a2ad3546d11338cdaa412a9cbf",
      },
      {
        id: "sidebar-shortcuts",
        title: "Improved",
        description: "Sidebar shortcut hints use compact keycaps and stay clear of badges.",
        commit: "3df97a78d11c7dd75c4b86856cefa7a3711cf5fd",
      },
      {
        id: "thread-resume",
        title: "Fixed",
        description: "A new message resumes chats blocked by an earlier provider failure.",
        commit: "f4d3d63fee922c3433bfb65863c97d2fb45eac73",
      },
      {
        id: "project-pull-requests",
        title: "Fixed",
        description: "Pull requests come from the project's primary GitHub repository.",
        commit: "8c2149b6270ea2ad3b8f34857f90669d40f8ebc0",
      },
      {
        id: "studio-projects-preserved",
        title: "Fixed",
        description: "Existing Studio folders remain available as normal projects.",
        commit: "fdcc171f51d6d5cae3b8c0db400cd591eba59daf",
      },
      {
        id: "retired-terminal-shortcuts",
        title: "Fixed",
        description: "Saved shortcuts for removed terminal threads are cleaned up automatically.",
        commit: "254650b8de5e63dcd6be79b8cc3cc9e6d8d7dc1d",
      },
    ],
  },
  {
    version: "0.0.3",
    date: "2026-09-28",
    features: [
      {
        id: "terminal-threads",
        title: "Removed",
        description: "Terminal threads are gone; sidebar terminals remain.",
        commit: "369d22a3af988562a18f2e61f939f22fba74b91d",
      },
      {
        id: "temporary-chats",
        title: "Removed",
        description: "Temporary chats and their delete-on-leave behavior are gone.",
        commit: "85f9a3bb56a6b14ba6addc35307b49da9f34f59c",
      },
      {
        id: "side-chats",
        title: "Removed",
        description: "Side chats and the /side command are gone.",
        commit: "41365fa0fd2157a8572ab89b186d1401d45dc35d",
      },
      {
        id: "source-control-review",
        title: "Improved",
        description: "Source control combines staging and Review in one panel.",
        commit: "a9e7cc0098785d81584c282210c02caa9a1c0236",
      },
      {
        id: "spaces",
        title: "Improved",
        description: "The unfiled Space is now Home, and chats stay in their assigned Space.",
        commit: "3a0f384885c131b1162bd3daa5ba11e960452863",
      },
      {
        id: "interface-motion",
        title: "Improved",
        description: "Menus, dialogs, panels, and disclosures use consistent motion.",
        commit: "718ba5c2a2e77f633403a17a7b8b4b87a6786591",
      },
      {
        id: "stable-layouts",
        title: "Fixed",
        description: "Chat transcripts and pull request filters keep their layout stable.",
        commit: "38986b71533add3ef3dc847e43ce45e1ccfb1c80",
      },
      {
        id: "provider-startup",
        title: "Fixed",
        description: "Cursor checks no longer open a login browser during onboarding.",
        commit: "fb410b2937d5ef77c8835ab7a45728a37d8149e6",
      },
    ],
  },
  {
    version: "0.0.2",
    date: "2026-09-28",
    features: [
      {
        id: "architecture-downloads",
        title: "Improved",
        description:
          "Smaller macOS downloads for Apple Silicon and Intel, with matching automatic updates.",
      },
      {
        id: "leaner-desktop",
        title: "Improved",
        description:
          "Desktop packages no longer carry unused Claude CLI copies or a duplicate Computer Use driver.",
      },
    ],
  },
  {
    version: "0.0.1",
    date: "2026-09-27",
    features: [
      {
        id: "glade-launch",
        title: "Added",
        description:
          "Initial launch with five providers: Codex, Claude Code, Cursor, Grok, and OpenCode.",
      },
    ],
  },
];
