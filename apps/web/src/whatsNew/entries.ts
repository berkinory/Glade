import type { WhatsNewEntry } from "./logic";

export const WHATS_NEW_ENTRIES: readonly WhatsNewEntry[] = [
  {
    version: "0.0.4",
    date: "Unreleased",
    features: [
      {
        id: "picker-menu-consistency",
        title: "Improved",
        description:
          "Branch and project pickers use compact menus; branch changes show only diff totals.",
      },
      {
        id: "faster-interface-motion",
        title: "Improved",
        description: "Menus, disclosures, and panels respond with quicker motion.",
      },
      {
        id: "panel-resizing",
        title: "Improved",
        description:
          "The sidebar has a sensible maximum width, and panel resizing follows the pointer smoothly.",
      },
      {
        id: "release-notes-layout",
        title: "Improved",
        description:
          "What's new groups changes by type, with subtle color and a simpler preview card.",
      },
      {
        id: "retired-terminal-shortcuts",
        title: "Fixed",
        description: "Saved shortcuts for removed terminal threads are cleaned up automatically.",
      },
      {
        id: "project-disclosure-motion",
        title: "Fixed",
        description: "Project lists expand and collapse with consistent motion in the sidebar.",
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
