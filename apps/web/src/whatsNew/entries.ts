import type { WhatsNewEntry } from "./logic";

export const WHATS_NEW_ENTRIES: readonly WhatsNewEntry[] = [
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
