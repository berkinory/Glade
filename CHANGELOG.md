# Glade Changelog

## 0.0.4 - Unreleased

### Removed

- Removed the new-worktree handoff flow and separate provider handoff controls.
- Removed the auto-generated Environment recap and its background model requests.
- Removed Studio mode, its dedicated workspace and output capture, and its UI, server API, settings, and tests.

### Improved

- The model picker lists connected providers with a shortcut to add more, and confirms a cross-provider selection before creating a handoff task with the chosen model. The new chat shows the provider transition in its transcript; the sidebar shows only its current provider.
- Interface animations now feel quicker and more consistent.
- The sidebar title shows the Glade mark in the current theme color.
- Settings now shows desktop update status and lets you check for, download, and install updates.
- The chat sidebar stops at 1.5× its default width; manual panel resizing responds directly to dragging.
- What's new groups release notes by change type and gives each section a subtle color; its preview card shows a general release message.

### Fixed

- The macOS Check for Updates menu items now show a refresh icon.
- Project lists now animate consistently when expanding and collapsing in the sidebar.
- Pull requests for a project now come from its primary GitHub repository instead of also showing upstream remotes.
- Regular folders no longer trigger a repository-unavailable warning in Pull requests.
- Existing Studio folders are preserved as normal projects so the app starts after Studio mode is removed.
- Removed terminal-thread shortcuts are cleaned from saved keybindings without changing other shortcuts.

## 0.0.3 - 2026-09-28

### Removed

- Terminal threads; sidebar terminals remain. ([369d22a3a](https://github.com/berkinory/Glade/commit/369d22a3af988562a18f2e61f939f22fba74b91d))
- Temporary chats and their delete-on-leave behavior. ([d6d52c897](https://github.com/berkinory/Glade/commit/d6d52c8971bb0592d208acf16f7d9801fbea51b6), [85f9a3bb5](https://github.com/berkinory/Glade/commit/85f9a3bb56a6b14ba6addc35307b49da9f34f59c))
- Side chats and the `/side` command. ([41365fa0f](https://github.com/berkinory/Glade/commit/41365fa0fd2157a8572ab89b186d1401d45dc35d))

### Improved

- Source control combines staging and Review in one panel. ([a9e7cc009](https://github.com/berkinory/Glade/commit/a9e7cc0098785d81584c282210c02caa9a1c0236))
- Menus, dialogs, panels, and disclosures use consistent motion. ([718ba5c2a](https://github.com/berkinory/Glade/commit/718ba5c2a2e77f633403a17a7b8b4b87a6786591))
- The unfiled Space is now Home. ([3a0f38488](https://github.com/berkinory/Glade/commit/3a0f384885c131b1162bd3daa5ba11e960452863))
- Desktop windows now have a 1024×700 minimum size. ([3dcfe2a39](https://github.com/berkinory/Glade/commit/3dcfe2a394ad0d31edc008bcf08cab6149f21bcc))

### Fixed

- Provider and validation errors show useful messages instead of stack traces. ([7d1b30df3](https://github.com/berkinory/Glade/commit/7d1b30df360c029d467dd9d18dd2fc61be68c7ac))
- Chats stay in their assigned Space; empty Spaces preserve their own drafts. ([3a0f38488](https://github.com/berkinory/Glade/commit/3a0f384885c131b1162bd3daa5ba11e960452863), [780c94437](https://github.com/berkinory/Glade/commit/780c944373c99210e99a840e6f1d1fc6d2d55797))
- Replies without file edits no longer show an Undo control. ([3a0f38488](https://github.com/berkinory/Glade/commit/3a0f384885c131b1162bd3daa5ba11e960452863))
- Chat transcripts, pull request filters, and Settings sections keep their layout stable. ([38986b715](https://github.com/berkinory/Glade/commit/38986b71533add3ef3dc847e43ce45e1ccfb1c80), [64d31759c](https://github.com/berkinory/Glade/commit/64d31759c5faa40a61f85b2e94e1a071877cd40e))
- Terminal tabs recover from temporary connection failures. ([abb659c60](https://github.com/berkinory/Glade/commit/abb659c601732013ee93653c42f4decdd9c54a1a))
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
