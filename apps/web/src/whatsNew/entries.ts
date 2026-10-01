import type { WhatsNewEntry } from "./logic";

export const WHATS_NEW_ENTRIES: readonly WhatsNewEntry[] = [
  {
    version: "0.1.0",
    date: "2026-10-01",
    features: [
      {
        id: "approve-an-action-that-codex",
        title: "New",
        description: "Approve an action that Codex auto-review denied.",
        commit: "eb78375833ad3f1d5d1638e193c8db5cf081eb9a",
      },
      {
        id: "manage-native-mcp-servers-installed",
        title: "New",
        description: "Manage native MCP servers and installed provider plugins from Settings.",
        commit: "748d6d5cfe806e3b423f8bac4128cf7594d34637",
      },
      {
        id: "mcp-servers-ask-form-input",
        title: "New",
        description:
          "MCP servers can ask for form input or a browser step in both Codex and Claude.",
        commit: "9f80da564c6714d7ae42ef7250e6e9885a386806",
      },
      {
        id: "models-options-come-connected-provider",
        title: "Improved",
        description:
          "Models and their options come from the connected provider, and Claude effort and speed changes apply live.",
        commit: "e8adbfda42ab44edc3ecce4038e19a4f7d433026",
      },
      {
        id: "codex-uses-your-existing-configuration",
        title: "Improved",
        description:
          "Codex uses your existing configuration, and shared skills load natively with their bundled resources.",
        commit: "e8adbfda42ab44edc3ecce4038e19a4f7d433026",
      },
      {
        id: "provider-settings-changed-outside-glade",
        title: "Improved",
        description:
          "Provider settings changed outside Glade stay in sync, and file changes appear live while an agent works.",
        commit: "d5053b634ecf0de806463d8fd952cd900e7a3140",
      },
      {
        id: "chat-titles-come-codex-claude",
        title: "Improved",
        description:
          "Chat titles come from Codex and Claude, and renames carry over to their own session lists.",
        commit: "9a27e0529ed04e443b68e63cb3ba16daec34e51a",
      },
      {
        id: "deleting-chat-deletes-provider-session",
        title: "Improved",
        description:
          "Deleting a chat also deletes its provider session history, and Codex chats archive and unarchive in Codex too.",
        commit: "5a763f43f2103eb300770c5cbac8a6c9f585eced",
      },
      {
        id: "claude-subagents-use-only-your",
        title: "Improved",
        description:
          "Claude subagents use only your own agents, with progress and controls from Claude.",
        commit: "52e4baddf7efcffe4fc39b688a21bd36be48446c",
      },
      {
        id: "compacting-conversation-works-same-way",
        title: "Improved",
        description:
          "Compacting a conversation works the same way for both providers, and Claude accepts optional instructions.",
        commit: "7a67e2738809fd287d8857363c51695a34b5b4aa",
      },
      {
        id: "codex-chats-share-background-processes",
        title: "Improved",
        description: "Codex chats share background processes and use less memory.",
        commit: "e2b4c8bff2a11549da0f55c340f820164ca6e02a",
      },
      {
        id: "streaming-replies-write-far-less",
        title: "Improved",
        description:
          "Streaming replies write far less to disk, and long code blocks stream smoothly without losing text selection.",
        commit: "0cfe0c1aacebafaf4bb191c3014f621c91a50560",
      },
      {
        id: "diffs-open-faster-stay-responsive",
        title: "Improved",
        description: "Diffs open faster and stay responsive in large changes.",
        commit: "26630491fdc7c977a33e97d27ce803bcd26a2503",
      },
      {
        id: "terminals-open-faster-load-image",
        title: "Improved",
        description: "Terminals open faster and load image support only when needed.",
        commit: "aa68a5b9ceed3dd95a872f9b39d310069182ca22",
      },
      {
        id: "sidebar-runs-far-fewer-git",
        title: "Improved",
        description:
          "The sidebar runs far fewer Git and GitHub commands, and Git status updates as soon as the repository changes.",
        commit: "de41433bef10fed92ed4deb41c27c2cb0109a590",
      },
      {
        id: "explorer-change-lists-stay-fast",
        title: "Improved",
        description: "Explorer and change lists stay fast and light in large repositories.",
        commit: "c8c7e7b52014f34cb786b4c82c5345c38f09fd5a",
      },
      {
        id: "file-editing-shows-clearer-line",
        title: "Improved",
        description:
          "File editing shows clearer line numbers, caret, active line and selection; the caret shape is configurable in Appearance, and Cmd+Y redoes edits on macOS.",
        commit: "2f96399020d872b47c04e2aa88e322eb469ca7fb",
      },
      {
        id: "file-search-chat-find-show",
        title: "Improved",
        description: "File search and chat find show plain names in compact, clickable rows.",
        commit: "ae61cbc2d4515822e4d208035de5184ccf4dac83",
      },
      {
        id: "project-chat-lists-use-show",
        title: "Improved",
        description:
          "Project chat lists use Show more and reset when collapsed, and queued messages have clear edit and delete actions.",
        commit: "aa2b7e3e3f54110b476f0c60f7fe0b8a731acae1",
      },
      {
        id: "editing-reverting-message-restores-only",
        title: "Fixed",
        description:
          "Editing or reverting a message restores only its own file changes and asks before overwriting later edits.",
        commit: "5217e4aaef56c944891cf3cdb16c0487545f32fa",
      },
      {
        id: "forking-message-no-longer-carries",
        title: "Fixed",
        description:
          "Forking from a message no longer carries later conversation into the new chat.",
        commit: "fd105bd80a0cc9ae6c91e129e115f3436bdda017",
      },
      {
        id: "computer-use-gateway-rules-reliably",
        title: "Fixed",
        description: "Computer Use and gateway rules reliably reach Codex sessions.",
        commit: "48174bbc7714e995c3088b45bcfa05c364c62fb3",
      },
      {
        id: "built-claude-commands-such-cost",
        title: "Fixed",
        description: "Built-in Claude commands such as /cost and /context show their output.",
        commit: "dd07529ef96d90aa71391e6c7ca25e83b8237434",
      },
      {
        id: "images-generated-by-codex-load",
        title: "Fixed",
        description:
          "Images generated by Codex load from their real saved file instead of a guessed path.",
        commit: "c545e809b2d5e842bf788b23e21378725def7bfa",
      },
      {
        id: "unsaved-file-edits-stay-available",
        title: "Fixed",
        description:
          "Unsaved file edits stay available across navigation and are marked in Explorer.",
        commit: "1c07fbc37ea348958280b5b676c0a99712c9a1a1",
      },
      {
        id: "general-search-shows-clear-chat",
        title: "Fixed",
        description:
          "General search shows clear chat and project labels and keeps chat workspaces out of project results.",
        commit: "316ad0dc2d57edae695bcceb09dd65827b8f1c24",
      },
      {
        id: "code-editor-search-controls-stay",
        title: "Fixed",
        description: "Code editor search controls stay steady as match counts change.",
        commit: "116b9680bda0e3350aa4c3b47262b503494cb3e0",
      },
      {
        id: "editing-sent-message-sends-enter",
        title: "Fixed",
        description: "Editing a sent message sends with Enter and uses standard action buttons.",
        commit: "3b7dd8d115ef0769e226ac9b44de7349c42dbe4f",
      },
      {
        id: "plan-mode-proposed-plans-thread",
        title: "Removed",
        description:
          "Plan mode, proposed plans, thread goals and debug mode were removed; provider permission modes remain.",
        commit: "10d6a0d2713bc6f8b8ee8582537b8be04b1e17ce",
      },
      {
        id: "kanban-board-was-removed",
        title: "Removed",
        description: "The Kanban board was removed.",
        commit: "3c122db072cc129e0ee7a823d7b44f02ae282a5d",
      },
      {
        id: "device-simulator-agent-controls-were",
        title: "Removed",
        description:
          "The device simulator and its agent controls were removed; Computer Use remains.",
        commit: "f5ed0905c7e52b2db9cf471ca66d320d8373fc84",
      },
      {
        id: "claude-cache-review-prompts-context",
        title: "Removed",
        description:
          "Claude cache-review prompts, context overrides and the Ultrathink picker were removed; Claude Code manages context itself.",
        commit: "e8adbfda42ab44edc3ecce4038e19a4f7d433026",
      },
      {
        id: "cursor-grok-opencode-providers-were",
        title: "Removed",
        description: "Cursor, Grok and OpenCode providers were removed.",
        commit: "604a0c3ceaf4ead71fffc203970b03f4e9be41df",
      },
      {
        id: "standalone-pull-requests-page-separate",
        title: "Removed",
        description:
          "The standalone Pull Requests page and the separate editor view were removed; editing stays in Explorer.",
        commit: "b13a0569f17534f8e663472a17d5523343198a61",
      },
      {
        id: "data-00x-previews-not-carried",
        title: "Removed",
        description:
          "Data from 0.0.x previews is not carried over. Glade 0.1.0 refuses to open a preview database; move state.sqlite out of the Glade data folder to start fresh.",
        commit: "7a8a22f63347e6bfd15edf03a005acbe5d53905b",
      },
    ],
  },
  {
    version: "0.0.5",
    date: "2026-09-29",
    features: [
      {
        id: "explorer-code-search",
        title: "New",
        description:
          "Search workspace contents from Explorer, filter matches, and jump directly to the matching line.",
        commit: "d827cfdd2cf5c5826c2926b6a1796106154982b4",
      },
      {
        id: "explorer-file-management",
        title: "New",
        description: "Create, rename, and delete files and folders directly in Explorer.",
        commit: "893378876700e32cc81cd2921d1edc7a29152361",
      },
      {
        id: "source-control-actions",
        title: "New",
        description:
          "Commit staged changes, switch branches, fetch, pull, push, and manage rebases from Source Control.",
        commit: "f51193d55340088197ecf9b09267f3a29a0b2b1e",
      },
      {
        id: "source-control-history",
        title: "New",
        description:
          "Browse and search commit history, inspect file diffs, and see branch and tag references.",
        commit: "c020041a02764e2276d90111fe5665a502fba982",
      },
      {
        id: "source-control-ai-messages",
        title: "New",
        description: "Generate commit messages from staged changes with AI.",
        commit: "f51193d55340088197ecf9b09267f3a29a0b2b1e",
      },
      {
        id: "source-control-bulk-actions",
        title: "New",
        description: "Stage, unstage, or revert multiple files together in Source Control.",
        commit: "40352945d5e7f8314bd4da7bf53b222d98fa2430",
      },
      {
        id: "source-control-ignore",
        title: "New",
        description: "Add untracked files and folders to .gitignore from Source Control.",
        commit: "f51193d55340088197ecf9b09267f3a29a0b2b1e",
      },
      {
        id: "workspace-editor",
        title: "Improved",
        description:
          "Large files now use the full editor with in-file search; save edits explicitly with Cmd/Ctrl+S.",
        commit: "12e24d1cd08d805508ad398b2550eac19245d90f",
      },
      {
        id: "workspace-panels",
        title: "Improved",
        description:
          "Workspace tools share a resizable sidebar, with chat terminals alongside Explorer and Source Control.",
        commit: "3a0a6c2279c0fcf394d6654ea647ebe849a2173c",
      },
      {
        id: "workspace-file-icons",
        title: "Improved",
        description:
          "File and folder icons are consistent across workspace tools, attachments, and code blocks.",
        commit: "eacb74af620fe53b492da2d1d2bdda2d382906d0",
      },
      {
        id: "chat-message-editing",
        title: "Fixed",
        description:
          "Editing messages preserves conversation history and staged changes without rewriting unchanged files. Stopped replies remain editable.",
        commit: "65521463052bb8c3b383269eaa2173fe9d76ab10",
      },
      {
        id: "chat-session-recovery",
        title: "Fixed",
        description:
          "Provider reconnects keep the composer available, and previously blocked chats recover after restarting.",
        commit: "65521463052bb8c3b383269eaa2173fe9d76ab10",
      },
      {
        id: "chat-reply-stability",
        title: "Fixed",
        description:
          "Replies stay in place as thinking turns into text, and delayed session updates no longer flicker the send controls.",
        commit: "bb24cd2cc3f3b2b2b0e0fa4e0b5c2b55328660e5",
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
        description: "Initial launch with coding-agent providers.",
      },
    ],
  },
];
