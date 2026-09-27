import type { WhatsNewEntry } from "./logic";

export const WHATS_NEW_ENTRIES: readonly WhatsNewEntry[] = [
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
