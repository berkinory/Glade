# Glade Changelog

## 0.0.3

### Removed

- Terminal threads; project terminals remain available in the sidebar.
- Temporary chats and their automatic deletion when leaving a chat.
- Side chats and the `/side` command. ([41365fa0f](https://github.com/berkinory/Glade/commit/41365fa0fd2157a8572ab89b186d1401d45dc35d))

### Improved

- The built-in unfiled Space is now Home.
- Default branch confirmations use a compact dialog with vertically stacked actions.
- Desktop windows now have a 1024×700 minimum size. ([3dcfe2a39](https://github.com/berkinory/Glade/commit/3dcfe2a394ad0d31edc008bcf08cab6149f21bcc))
- Editor picker icons appear immediately. ([08b815d53](https://github.com/berkinory/Glade/commit/08b815d5336e7e63c5241bc1bc69d0e858c4f55f))

### Fixed

- Provider and validation errors show concise messages instead of stack traces in toasts, panels, tool results, and production crash screens.
- Empty Spaces restore their own unsent chat instead of carrying the chat from another Space.
- Chats and pinned chats appear only in their assigned Space; older chats remain in Home.
- Replies that ran no tools no longer claim shared-workspace edits or offer Undo for them.
- The empty project message stays visible while adding a project. ([780c94437](https://github.com/berkinory/Glade/commit/780c944373c99210e99a840e6f1d1fc6d2d55797))
- Pull request filters and Settings sections no longer shift when their content changes.
- Chat transcripts now resize with the window.
- Terminal tabs recover from temporary connection failures. ([abb659c60](https://github.com/berkinory/Glade/commit/abb659c601732013ee93653c42f4decdd9c54a1a))
- The right panel closes with its last terminal or browser tab. ([2cf366410](https://github.com/berkinory/Glade/commit/2cf366410e964cf4a8827f4780c5e5848ad763a8))
- Cursor checks no longer open a login browser, and provider warnings wait until the provider is used. ([fb410b293](https://github.com/berkinory/Glade/commit/fb410b2937d5ef77c8835ab7a45728a37d8149e6))
- Onboarding no longer advertises external agent pairing. ([070d59211](https://github.com/berkinory/Glade/commit/070d59211a1d1669ab19bfd569311b5331b30c89))

## 0.0.2 - 2026-09-28

### Improved

- macOS downloads now match Apple Silicon and Intel separately, with architecture-aware automatic updates and Homebrew installation.
- Desktop downloads are smaller after removing unused bundled Claude CLI binaries and a duplicate Computer Use driver.
- Release builds reuse verified main CI results and prepare native driver caches before publication.

## 0.0.1 - 2026-09-27

### Added

- Initial launch with five providers: Codex, Claude Code, Cursor, Grok, and OpenCode.
