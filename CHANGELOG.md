# Glade Changelog

## 0.0.5 - Unreleased

### New

- Source Control has a History tab with commit author, date, hash, full-branch commit-message filtering, and a read-only per-commit diff preview.
- Source Control adds staged-only commits with Cmd/Ctrl+Enter, a compact branch picker, fetch, pull, push, and rebase with conflict continuation and abort.
- Generate commit messages from staged changes using the configured Git writing AI, without staging files or committing.
- Source Control file menus can add untracked paths to the root .gitignore, preserving existing rules and escaping filenames literally.
- Outgoing and incoming commit counts appear beside Fetch for branches with an upstream.
- Explorer supports creating files and folders with inline names, renaming, deleting, and opening folders in the platform file manager.
- Source Control file rows support Cmd/Ctrl and Shift selection for bulk staging, unstaging, and reverting from the context menu.

### Improved

- History loads virtualized rows as you scroll, shows author photos when available, relative times, tags, and compact upstream status icons. Commit rows have an icon menu to copy the full hash, short hash, or subject. Selected commits open below with every file diff initially collapsed and file-shaped loading placeholders. Source Control tabs have icons and the Changes and History detail panes use 60% of the panel.
- Review panels switch between stacked and split diffs with one toolbar button.
- Commit message AI enables supported fast mode and disables thinking when available, otherwise selecting the lowest supported effort, with a 90-second deadline.
- The compact commit input keeps its AI action, spinner, and commit button aligned with the first line without overlapping text. Rebase uses the shared tooltip.
- Source Control keeps file status letters visible without shifting rows during hover, opens files in Explorer, and preserves staged content when reverting unstaged changes. Newly created Explorer files open in the editor.
- Empty Staged sections stay hidden, and the diff pane uses 60% of the available height.
- Changes header totals and untracked file rows include new-file line counts through a separate stats request, so the file list does not wait for content-based counting. Header totals remain visible while refreshing.
- Source Control section headers use the same + and - actions as file rows. Stage and unstage refresh the file list first while broader Git status and diff refreshes finish in the background.
- Source Control lists changed files from Git metadata without loading the full patch and uses the same workspace as Explorer. Its diff pane opens only after selecting a file. Refresh sits beside Staged; loading uses the shared spinner, and the empty state shows the checkout path.
- Explorer menus have action icons, file previews show concise errors, and edits save explicitly with Cmd/Ctrl+S. Folder expansion changes without height or chevron motion.
- File and folder icons across Explorer, editor, search, diffs, message attachments, and code-block headers use the bundled Symbols icon theme.
- The right sidebar opens on Explorer and keeps Explorer, Terminal, Source Control, Browser, and Simulator in a fixed order. Chat terminals use the sidebar instead of a bottom drawer.
- The right sidebar has a 28rem minimum width and can expand to 1.5 times its opening width. Panel buttons use icons, and switching panels preserves the resized width.
- Sidebar icons align more closely with their labels in project, chat, and Activity rows.
- The composer model button shows reasoning in readable text and leaves context limits in the model details.
- Shortcut hints use the same compact keycap throughout tooltips, menus, and the sidebar.
- Release notes separate new features under New from improvements and fixes in both the changelog and the app.

### Fixed

- Chat header action labels stay visible when opening or closing a sidebar.
- Deleting an Explorer file closes its preview. Finder actions use the system icon, and file breadcrumbs keep descenders visible.
- Chat rows and headers show the provider icon even when the terminal is the saved primary view.

- Replies keep their position as thinking gives way to text. Delayed session updates no longer flicker the activity indicator or briefly replace Stop with Send.
- Codex keeps its runtime between replies when native tool-call identity is available. Codex and Claude gateway calls stay bound to their originating turn; runtimes without call provenance renew safely. Background reconnects keep the composer available.
- Editing a message no longer rewrites unchanged workspace files, avoiding unnecessary dev reloads, and preserves staged changes. The separate message Revert button was removed.
- Stopped turns remain editable. Edits rewind native Codex, Claude, and OpenCode history without replacing it with a summary or briefly clearing the chat; stale edits show a short warning.
- Older blocked chats recover on restart. Error toasts stay short and let you copy the full detail.
- Provider bookkeeping stays out of the transcript. Codex startup logs respect their severity, and MCP connection failures show one concise message instead of retry traces.

## 0.0.4 - 2026-09-28

### Removed

- Studio mode and its dedicated workspace flows were removed. ([648d50fb1](https://github.com/berkinory/Glade/commit/648d50fb1194ffe60e273cf07407231eb6e5d910))
- Environment recaps and their background model requests were removed. ([971784b30](https://github.com/berkinory/Glade/commit/971784b305809ea4d0e02392853874d9b119727d))
- New-worktree handoff and separate provider handoff controls were removed. ([177bf8085](https://github.com/berkinory/Glade/commit/177bf808538d03182e0368fc02151debdfd559ed))
- Sidebar customization and the Docs link were removed; feedback now opens the issue form. ([419ef9b1c](https://github.com/berkinory/Glade/commit/419ef9b1c541a9c82612f1322acf865f14af6373))

### Improved

- The model picker shows connected providers, keeps a steady height, and confirms cross-provider handoff with the chosen model. The new chat shows the transition. ([177bf8085](https://github.com/berkinory/Glade/commit/177bf808538d03182e0368fc02151debdfd559ed), [01f2e8624](https://github.com/berkinory/Glade/commit/01f2e862442ce63cbda03983f3a9d1c4584200c8))
- Settings can check, download, and install desktop updates. ([14381fb8c](https://github.com/berkinory/Glade/commit/14381fb8cb07f16cdd725fe7177760d674ef268d))
- Branch and project pickers use compact menus; branch actions show diff totals without duplicate usage. ([341bd13f8](https://github.com/berkinory/Glade/commit/341bd13f8b43d4a2ad3546d11338cdaa412a9cbf), [953df655e](https://github.com/berkinory/Glade/commit/953df655e527cbf5aa015b987d006f6c63868e81))
- The sidebar has a width limit, smoother resizing, and compact shortcut hints that do not overlap badges. ([f254913a5](https://github.com/berkinory/Glade/commit/f254913a581ab68a112e2a6022938145e70565ba), [13d85c71f](https://github.com/berkinory/Glade/commit/13d85c71fe7c45b089e51fbf7c0c6f828290bfd6), [3df97a78d](https://github.com/berkinory/Glade/commit/3df97a78d11c7dd75c4b86856cefa7a3711cf5fd))
- Tooltips open after 300 ms; message action icons sit closer together. ([1760eee7f](https://github.com/berkinory/Glade/commit/1760eee7fa5ddfb6ab6578c17d0dd2a15760a9eb), [4beac45f9](https://github.com/berkinory/Glade/commit/4beac45f9344f508c3a4abc691a78e17f556bc04))
- Menus, panels, and project lists animate more consistently. ([fb63366e7](https://github.com/berkinory/Glade/commit/fb63366e7051ddc191305f5766cb766dbd067db7))
- What's new groups release notes by change type and shows a simpler preview. ([60cd9847f](https://github.com/berkinory/Glade/commit/60cd9847fdaea45ad448b6922fb1c43d1906f54b))

### Fixed

- Sending a message resumes a chat blocked by an earlier provider failure. ([f4d3d63fe](https://github.com/berkinory/Glade/commit/f4d3d63fee922c3433bfb65863c97d2fb45eac73))
- Pull requests use the project's primary GitHub repository; ordinary folders no longer show a repository warning. ([8c2149b62](https://github.com/berkinory/Glade/commit/8c2149b6270ea2ad3b8f34857f90669d40f8ebc0))
- Existing Studio folders remain available as normal projects after upgrading. ([fdcc171f5](https://github.com/berkinory/Glade/commit/fdcc171f51d6d5cae3b8c0db400cd591eba59daf))
- Saved shortcuts for retired terminal threads are cleaned up. ([254650b8d](https://github.com/berkinory/Glade/commit/254650b8de5e63dcd6be79b8cc3cc9e6d8d7dc1d))
- The macOS Check for Updates menu item has an icon. ([0785150a1](https://github.com/berkinory/Glade/commit/0785150a1fab59f17f7c708fe847246822b24e5d))

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

### New

- Initial launch with five providers: Codex, Claude Code, Cursor, Grok, and OpenCode.
