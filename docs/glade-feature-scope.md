# Glade product scope

Glade has two application identities: Dev and Prod. Prod uses `com.agent.glade`,
Dev uses `com.agent.glade.dev`. Dev uses unbadged blueprint artwork; Prod uses
production artwork. Production updates come only from the Glade release repository.

## Removed features

- Editor view: no separate chat rail or editor-specific route state.
  Workspace editing remains in the regular Explorer pane.
- Browser login import: no cookie extraction, browser profile enumeration or import IPC.
  Manual sign-in, existing browser sessions and the ordinary password vault remain.
- AppSnap: no capture picker, global capture shortcut, composer capture cards,
  announcement or background watcher. Existing image attachments remain readable.
- Custom model registration: no editor, registration settings schema or saved custom
  model list. Provider discovery and selecting a model already supplied by a provider remain.
- External agent connections: no pairing UI, external MCP HTTP transport, CLI commands,
  management RPC or integration authorization runtime. Provider MCP and the internal
  agent gateway remain available to authenticated provider sessions.
- Alternate application channels: no extra installers, flavors, badges, update feeds,
  profile import or automatic remote diagnostics.
- Side chats: no right dock pane, creation command, expiry worker, or retained side chat
  conversation history. Regular forks and split views remain available.
- Temporary chats: no composer toggle, sidebar badge, or delete-on-leave lifecycle.
  Existing conversations and unsent drafts remain available as regular chats.
- Terminal threads: no project action, creation shortcut, terminal-specific draft slot,
  or automatic thread naming and deletion. The right sidebar hosts chat terminals;
  the bottom terminal drawer has been removed.

These are physical removals, not dormant implementations behind feature flags.

## Shared Computer functionality

`apps/desktop/native/computer` provides the permission guide, permission checks,
input release, Escape monitoring, activation shield and preview frame tap used by
Computer Use. `apps/desktop/src/computer/computerPermissions.ts` owns permission state and guide lifecycle;
`apps/desktop/src/computer/computerHelperProtocol.ts` validates helper messages. These do not expose capture
attachment APIs or a keyboard capture watcher.

## Workspace editing

Explorer owns file tabs for tree selections, chat links and file references. Opening
an existing file selects its tab; line and column links reveal source without changing
the saved Markdown viewing preference. Markdown opens rendered by default, and the
source/rendered setting applies across files and chats. Unsaved editor sessions remain
available when switching or closing tabs. Absolute local paths and generated files
use the same Explorer preview, including images and PDFs.

Explorer follows external filesystem changes in its open folders without manual
refresh. Files and folders can be copied into the tree with drag and drop or pasted
while the tree has focus. Folder rows target that folder, file rows target their
parent, and empty tree space targets the workspace root. Imports preserve sources
and refuse existing names; partial folder failures report what needs review.
Editor and composer paste retain their existing behavior.

Explorer, Terminal and Source Control share their panel tab bar. Environment and its
trigger hide while the right sidebar is open, retaining the previous preference
and panel state until it closes.

All editable workspace text files use the shared Pierre editor, including large
files. Cmd/Ctrl+F opens its in-file
search while the editor has focus instead of triggering chat search. File length
no longer switches to a textarea editor. Read-only previews and binary-file
handling retain their existing limits.

## Explorer search

Explorer switches between the file tree/name search and content search. Content
search uses the existing workspace index, matches plain text from two characters with match-case and whole-word toggles,
and groups up to 100 matching lines by file without a per-file five-line cap. Selecting a result
opens its source line in the shared editor without discarding existing drafts,
selects the same file in Explorer, expands its parent folders, and scrolls it into
view once those folders finish loading.
Queries are debounced and scans run one at a time. Search loading reuses Explorer
skeleton rows, file headers open the first match, and the active view is highlighted. The existing scan excludes
binary files and files larger than 512 KiB, has a four-second scan budget, and
reports index/result/time truncation. Regex, replace, and include/exclude filters
are not exposed in this first version.

## Source Control

Source Control combines current changes, immutable turn checkpoint diffs and commit history. Turn diffs offer a return to current changes; Show file opens the working-tree file in Explorer. Ordinary chat file links reveal files in Explorer, including supplied line and column targets.

Source Control shows outgoing and incoming commit counts to the left of Fetch when
the branch has an upstream. Incoming counts reflect the last fetched remote state.

History pages through commits on the current branch as the virtualized list scrolls.
Filtering searches commit messages across the branch, including unloaded pages.
Selecting a commit shows its read-only patch below the list with file diffs
initially collapsed; large patches are capped and marked partial. The detail pane
uses 60% of the available height, as does the Changes diff pane.
Commit rows offer an icon menu to copy the full hash, short hash, or subject, and undo
the latest eligible unpublished commit while preserving staged and unstaged changes.
History rows show author initials, relative time, and tags. Commits reachable
from the tracked remote branch have a green up arrow; newer local commits have
a yellow commit icon.
Merge commits carry a Merge marker. Local and remote branch names appear only
on the commit each branch currently points to; this is not a branch graph.
Repositories without a remote upstream show neither icon.

The right dock supports staged-only commits with a workspace-scoped message draft
and Cmd/Ctrl+Enter, AI message generation from staged changes without index or commit mutations, fetch across configured remotes, fast-forward-only pull, push of existing commits, and the
shared branch picker. Commit message generation uses the configured model, enables advertised fast mode, and disables thinking or selects the lowest advertised effort. Its 90-second deadline includes model discovery. The commit button stays aligned with the first input line.
Push fetches its destination, fast-forwards incoming history or rebases unpublished
local commits before pushing normally. Integration requires saved editors and a clean
working tree; it never uses automatic stashing or force push. Source Control shows
conflicted files and operation-specific Continue and Abort actions. A push interrupted
by rebase conflicts retains its recovery intent across restart.
File menus add selected untracked files to the repository-root `.gitignore` using
literal, rooted paths; tracked files remain tracked and existing ignore rules are preserved.

## Existing data

Databases start from the single baseline at migration 1, released in 0.1.0. Databases
from 0.0.x previews are not opened or modified; Glade asks the user to move them aside.
Future schema changes use appended migrations starting at 2.

Old OS profiles and manual browser sessions are not deleted. Persisted image bytes
remain readable even when removed capture-specific display metadata is discarded.

## Completion checks

Audit implementation, registration, contracts, startup, background work, UI, search,
onboarding, assets, dependencies, docs and release scripts together.
Verify retained functionality as well as removals. Use the actual Dev launcher for
icon checks; build and verify signed artifacts from the final source snapshot.
