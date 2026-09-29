import type { WhatsNewEntry } from "./logic";

export const WHATS_NEW_ENTRIES: readonly WhatsNewEntry[] = [
  {
    version: "0.0.5",
    date: "Unreleased",
    features: [
      {
        id: "consistent-workspace-editor",
        title: "Improved",
        description:
          "Editable files use the advanced editor at every size, with Cmd/Ctrl+F file search that no longer opens chat search.",
      },
      {
        id: "source-control-adds-staged-only-commits-with-cmd-ctrl",
        title: "New",
        description:
          "Source Control adds staged-only commits with Cmd/Ctrl+Enter, a compact branch picker, fetch, pull, push, and rebase with conflict continuation and abort.",
      },
      {
        id: "generate-commit-messages-from-staged-changes-using-the-configured",
        title: "New",
        description:
          "Generate commit messages from staged changes using the configured Git writing AI, without staging files or committing.",
      },
      {
        id: "source-control-file-menus-can-add-untracked-paths-to",
        title: "New",
        description:
          "Source Control file menus can add untracked paths to the root .gitignore, preserving existing rules and escaping filenames literally.",
      },
      {
        id: "outgoing-and-incoming-commit-counts-appear-beside-fetch-for",
        title: "New",
        description:
          "Outgoing and incoming commit counts appear beside Fetch for branches with an upstream.",
      },
      {
        id: "explorer-supports-creating-files-and-folders-with-inline-names",
        title: "New",
        description:
          "Explorer supports creating files and folders with inline names, renaming, deleting, and opening folders in the platform file manager.",
      },
      {
        id: "source-control-file-rows-support-cmd-ctrl-and-shift",
        title: "New",
        description:
          "Source Control file rows support Cmd/Ctrl and Shift selection for bulk staging, unstaging, and reverting from the context menu.",
      },
      {
        id: "review-panels-switch-between-stacked-and-split-diffs-with",
        title: "Improved",
        description:
          "Review panels switch between stacked and split diffs with one toolbar button.",
      },
      {
        id: "commit-message-ai-enables-supported-fast-mode-and-disables",
        title: "Improved",
        description:
          "Commit message AI enables supported fast mode and disables thinking when available, otherwise selecting the lowest supported effort, with a 90-second deadline.",
      },
      {
        id: "the-compact-commit-input-keeps-its-ai-action-spinner",
        title: "Improved",
        description:
          "The compact commit input keeps its AI action, spinner, and commit button aligned with the first line without overlapping text. Rebase uses the shared tooltip.",
      },
      {
        id: "source-control-keeps-file-status-letters-visible-without-shifting",
        title: "Improved",
        description:
          "Source Control keeps file status letters visible without shifting rows during hover, opens files in Explorer, and preserves staged content when reverting unstaged changes. Newly created Explorer files open in the editor.",
      },
      {
        id: "empty-staged-sections-stay-hidden-and-the-diff-pane",
        title: "Improved",
        description:
          "Empty Staged sections stay hidden, and the diff pane uses 55% of the available height.",
      },
      {
        id: "changes-header-totals-and-untracked-file-rows-include-new",
        title: "Improved",
        description:
          "Changes header totals and untracked file rows include new-file line counts through a separate stats request, so the file list does not wait for content-based counting. Header totals remain visible while refreshing.",
      },
      {
        id: "source-control-section-headers-use-the-same-and-actions",
        title: "Improved",
        description:
          "Source Control section headers use the same + and - actions as file rows. Stage and unstage refresh the file list first while broader Git status and diff refreshes finish in the background.",
      },
      {
        id: "source-control-lists-changed-files-from-git-metadata-without",
        title: "Improved",
        description:
          "Source Control lists changed files from Git metadata without loading the full patch and uses the same workspace as Explorer. Its diff pane opens only after selecting a file. Refresh sits beside Staged; loading uses the shared spinner, and the empty state shows the checkout path.",
      },
      {
        id: "explorer-menus-have-action-icons-file-previews-show-concise",
        title: "Improved",
        description:
          "Explorer menus have action icons, file previews show concise errors, and edits save explicitly with Cmd/Ctrl+S. Folder expansion changes without height or chevron motion.",
      },
      {
        id: "file-and-folder-icons-across-explorer-editor-search-diffs",
        title: "Improved",
        description:
          "File and folder icons across Explorer, editor, search, diffs, message attachments, and code-block headers use the bundled Symbols icon theme.",
      },
      {
        id: "the-right-sidebar-opens-on-explorer-and-keeps-explorer",
        title: "Improved",
        description:
          "The right sidebar opens on Explorer and keeps Explorer, Terminal, Source Control, Browser, and Simulator in a fixed order. Chat terminals use the sidebar instead of a bottom drawer.",
      },
      {
        id: "the-right-sidebar-has-a-28rem-minimum-width-and",
        title: "Improved",
        description:
          "The right sidebar has a 28rem minimum width and can expand to 1.5 times its opening width. Panel buttons use icons, and switching panels preserves the resized width.",
      },
      {
        id: "sidebar-icons-align-more-closely-with-their-labels-in",
        title: "Improved",
        description:
          "Sidebar icons align more closely with their labels in project, chat, and Activity rows.",
      },
      {
        id: "the-composer-model-button-shows-reasoning-in-readable-text",
        title: "Improved",
        description:
          "The composer model button shows reasoning in readable text and leaves context limits in the model details.",
      },
      {
        id: "shortcut-hints-use-the-same-compact-keycap-throughout-tooltips",
        title: "Improved",
        description:
          "Shortcut hints use the same compact keycap throughout tooltips, menus, and the sidebar.",
      },
      {
        id: "release-notes-separate-new-features-under-new-from-improvements",
        title: "Improved",
        description:
          "Release notes separate new features under New from improvements and fixes in both the changelog and the app.",
      },
      {
        id: "chat-header-action-labels-stay-visible-when-opening-or",
        title: "Fixed",
        description: "Chat header action labels stay visible when opening or closing a sidebar.",
      },
      {
        id: "deleting-an-explorer-file-closes-its-preview-finder-actions",
        title: "Fixed",
        description:
          "Deleting an Explorer file closes its preview. Finder actions use the system icon, and file breadcrumbs keep descenders visible.",
      },
      {
        id: "chat-rows-and-headers-show-the-provider-icon-even",
        title: "Fixed",
        description:
          "Chat rows and headers show the provider icon even when the terminal is the saved primary view.",
      },
      {
        id: "replies-keep-their-position-as-thinking-gives-way-to",
        title: "Fixed",
        description:
          "Replies keep their position as thinking gives way to text. Delayed session updates no longer flicker the activity indicator or briefly replace Stop with Send.",
      },
      {
        id: "codex-keeps-its-runtime-between-replies-when-native-tool",
        title: "Fixed",
        description:
          "Codex keeps its runtime between replies when native tool-call identity is available. Codex and Claude gateway calls stay bound to their originating turn; runtimes without call provenance renew safely. Background reconnects keep the composer available.",
      },
      {
        id: "editing-a-message-no-longer-rewrites-unchanged-workspace-files",
        title: "Fixed",
        description:
          "Editing a message no longer rewrites unchanged workspace files, avoiding unnecessary dev reloads, and preserves staged changes. The separate message Revert button was removed.",
      },
      {
        id: "stopped-turns-remain-editable-edits-rewind-native-codex-claude",
        title: "Fixed",
        description:
          "Stopped turns remain editable. Edits rewind native Codex, Claude, and OpenCode history without replacing it with a summary or briefly clearing the chat; stale edits show a short warning.",
      },
      {
        id: "older-blocked-chats-recover-on-restart-error-toasts-stay",
        title: "Fixed",
        description:
          "Older blocked chats recover on restart. Error toasts stay short and let you copy the full detail.",
      },
      {
        id: "provider-bookkeeping-stays-out-of-the-transcript-codex-startup",
        title: "Fixed",
        description:
          "Provider bookkeeping stays out of the transcript. Codex startup logs respect their severity, and MCP connection failures show one concise message instead of retry traces.",
      },
    ],
  },
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
        title: "New",
        description:
          "Initial launch with five providers: Codex, Claude Code, Cursor, Grok, and OpenCode.",
      },
    ],
  },
];
