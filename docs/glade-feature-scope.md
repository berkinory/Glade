# Glade product scope

Glade has two application identities: Dev and Prod. Prod uses `com.agent.glade`,
Dev uses `com.agent.glade.dev`. Dev uses unbadged blueprint artwork; Prod uses
production artwork. Production updates come only from the Glade release repository.

## Removed features

- Editor view: no separate chat rail or editor-specific route state.
  Workspace editing opens in the conversation’s main workspace tabs.
- Browser login import: no cookie extraction, browser profile enumeration or import IPC.
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
  or automatic thread naming and deletion. The main workspace hosts chat terminals;
  the bottom terminal drawer has been removed.

These are physical removals, not dormant implementations behind feature flags.

## Browser Use and Computer Use

Browser Use (the in-app browser that agents drive through the agent gateway) and
Computer Use (desktop control) are being rebuilt and are unavailable on this branch.
Neither has a settings page, slash command, chat card, desktop host or server runtime
until the rebuild lands. [COMPUTER-USE-PLAN.md](../COMPUTER-USE-PLAN.md) tracks the work.

## Workspace editing

Each conversation owns main workspace tabs for chat, files, commit and turn diffs, and terminals. The chat tab uses the provider icon and name and stays at the left of the tab strip. Workspace tabs replace the chat title in the existing top bar; no extra tab row is added. Provider usage stays in the left sidebar, and chat headers do not show Open in or Commit and push actions. Explorer and Git remain navigation panels in the right sidebar. Selecting Explorer files or Git files opens or focuses their main workspace tab. Single-clicks reuse one italic preview tab across files and Git diffs; double-clicking a file or its tab, editing, or opening a chat file reference keeps it as a permanent tab. File search opens previews too. The provider chat tab cannot be closed. Cmd+W or Ctrl+W closes the active resource tab and returns to the most recently used open tab; when only the chat tab remains, the shortcut leaves the conversation without closing the app. The tab strip supports horizontal trackpad scrolling and reveals newly selected tabs. The plus menu contains only Terminal. Terminals use the main tab strip without an inner toolbar. File diffs share the file viewer header, offer unified and side-by-side layouts, and expose Edit to open the working file. Saved project actions, automatic setup scripts, and project Run controls are not supported. Tab selection is remembered per conversation. Configurable `workspaceTab.previous` and `workspaceTab.next` shortcuts cycle through these tabs in visual order and wrap at either end, using the same selection path as a click. Sidebar PR status appears after the workspace metadata with its accessible open action. Metadata and hover actions share an intrinsic grid width in pinned and ordinary rows, so titles reserve the actual content width as typography changes.

File tabs accept tree selections, chat links and file references. Opening
an existing file selects its tab; line and column links reveal source without changing
the saved Markdown viewing preference. Markdown opens rendered by default, and the
source/rendered setting applies across files and chats. Unsaved editor sessions remain
available when switching or closing tabs. Absolute local paths and generated files
use the same workspace preview, including images and PDFs.

Explorer follows external filesystem changes in its open folders without manual
refresh. Files and folders can be copied into the tree with drag and drop or pasted
while the tree has focus. Folder rows target that folder, file rows target their
parent, and empty tree space targets the workspace root. Imports preserve sources
and refuse existing names; partial folder failures report what needs review.
Editor and composer paste retain their existing behavior.

Workspace resources share one tab bar and do not split; Explorer dragging retains file-reference
behavior. Terminal split controls appear in the top bar when a terminal is selected. Cmd/Ctrl+D
splits the focused terminal side by side, and Cmd/Ctrl+Shift+D splits it above/below. Splits remain
inside the same terminal tab, support mixed nested directions, and divide the available viewport
without scrolling the layout. Repeated splits redistribute space to avoid increasingly tiny tiles.
Selecting a tile focuses that terminal; further splits target it. Cmd/Ctrl+W closes only the focused
shell; its tab disappears when the last shell closes.
Terminal tab activity includes every tile. Closing a terminal tab confirms running activity once
and closes its sessions; when an individual shell exits, its tile collapses and siblings expand.
Layouts survive reloads, and existing xterm views and PTY sessions remain attached while tiling.
Existing split conversations retain their panel layout. Environment and its
trigger hide while the right sidebar is open, retaining the previous preference
and panel state until it closes.

All editable workspace text files use the shared Pierre editor, including large
files. Cmd/Ctrl+F opens its in-file
search while the editor has focus instead of triggering chat search. File length
no longer switches to a textarea editor. Read-only previews and binary-file
handling retain their existing limits.

## Explorer search

Explorer has one content search field with file and folder creation buttons beside it.
The file tree appears while the query is shorter than two characters; filename search stays in Cmd+P. Content
search uses the existing workspace index, matches plain text from two characters with match-case and whole-word toggles,
and groups up to 100 matching lines by file without a per-file five-line cap. Selecting a result
opens its source line in the shared editor without discarding existing drafts,
selects the same file in Explorer, expands its parent folders, and scrolls it into
view once those folders finish loading.
Explorer shows the current workspace root folder name above content search.
Queries are debounced, and superseded scans are cancelled. Unchanged file contents are reused from a bounded cache; metadata is checked before reuse. The four-second scan budget includes waiting for the file index. Search loading reuses Explorer
skeleton rows. Results are virtualized, and visible source lines up to 1,000 characters use syntax coloring while retaining search-match emphasis. File headers open the first match, and the active view is highlighted. The existing scan excludes
binary files and files larger than 512 KiB and
reports index/result/time truncation. Regex, replace, and include/exclude filters
are not exposed in this first version.

## Source Control

Source Control combines current changes, immutable turn checkpoint diffs and commit history. Turn diffs offer a return to current changes; Edit opens the working-tree file in a main workspace tab. Ordinary chat file links reveal files in Explorer, including supplied line and column targets.

Folders without Git offer Initialize Repository. For local repositories without a
remote, Push opens Publish to GitHub with a picker for the signed-in GitHub CLI
account and its organizations, an editable repository name with the full owner/name below,
and private/public visibility buttons.
Private is the default. Publishing requires GitHub CLI authentication and at least
one commit; it creates the repository, adds origin and pushes committed history.
Existing remotes use ordinary Push. If creation succeeds but push fails, the
repository and origin remain available for another Push after resolving the error.

Changes sorts paths by folder within each staged/unstaged group. New filter queries can reuse the same bounded Git inventory for up to two seconds; refreshes, repository updates and mutations read a fresh inventory. Capacity and transport interruptions recover automatically without a manual refresh; persistent failures expose their error details. Selection stays in
one group, and selected rows keep their applicable actions visible. Stage, Unstage
and Revert apply to that selection; deleted rows have no View action.

Below 5,000 unique changed paths, Changes uses its normal virtualized list. Larger
checkouts show a folder/count summary and bounded, searchable results. A partially
staged file counts once. When metadata exceeds the collection budget, counts are
lower bounds and search coverage is marked incomplete. Stage all, Unstage all and
empty-index commits still address all Changes, rather than the visible results.

Selected media is loaded on demand. Changes images use the working tree, Staged
images use the index, and History images use the selected commit. Missing content
is shown explicitly. Git media previews are bounded to 16 MB; local workspace video
previews are bounded to 32 MB. Videos show a static thumbnail with no player or
autoplay, and decoder/blob resources are released when no longer needed.

Changes and History revalidate automatically on repository events and reconnect or
focus. Ordinary file edits refresh working-copy data without resetting History.
Ref/HEAD movements refresh active history and branch queries; remote fetch remains
separate from filesystem notifications. Retry controls remain for actual failures.

Source Control shows outgoing and incoming commit counts to the left of Fetch when
the branch has an upstream. Incoming counts reflect the last fetched remote state.

History pages through commits on the current branch as the virtualized list scrolls.
Filtering searches commit messages across the branch, including unloaded pages.
Selecting a commit shows its details below the history list. In single conversations,
selecting a commit file opens its read-only diff in the main workspace preview tab;
large patches are capped and marked partial. Split conversations retain inline file previews.
Commit rows offer an icon menu to copy the full hash, short hash, or subject, and undo
the latest eligible unpublished commit while preserving staged and unstaged changes.
History rows show author initials, relative time, and tags. Commits reachable
from the tracked remote branch have a green up arrow; newer local commits have
a yellow commit icon.
Merge commits carry a Merge marker. Local and remote branch names appear only
on the commit each branch currently points to; this is not a branch graph.
Repositories without a remote upstream show neither icon.

The right dock commits staged changes, or explicitly stages all Changes when the index
is empty, with a workspace-scoped message draft and Cmd/Ctrl+Enter. AI generation
reads staged changes when present, otherwise all Changes, without index or commit
mutations. The dock also supports fetch across configured remotes, fast-forward-only
pull, push of existing commits, and the
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

## Visual replies

Agents can publish self-contained HTML with `html_render`. A reply belongs to its active turn, survives reloads and projection
rebuilds, and is removed with its turn or conversation. HTML and optional PNG previews
use managed attachment quotas and cleanup. Activity history caps preserve visual
reply references. The authenticated source endpoint serves plain text; generic HTML
attachments download with a restrictive sandbox policy.

Inline visuals use a transparent canvas with no default body padding and rounded frame corners when content paints a background. Agents keep the outer page unframed and use intentional themed inner surfaces with at least 16 pixels of padding; live theme variables include surfaces, controls, categorical chart colors, radius and monospace typography.
Published replies retain the requested height and optional width measurements. Inline height uses the larger measurement bracketing the current width until the iframe reports its live content height. An explicitly shorter height scrolls; otherwise narrow layouts may grow up to 2000 pixels. Existing replies without measurements still use live sizing.
Preview defaults to dark at a 728-pixel width, supports an explicit light appearance, and crops screenshots to content within the requested height.
Inline visuals load when first visible and stay mounted when scrolled offscreen, preserving in-memory edits. Inline visuals blend into the transcript; save and expand icons appear on hover or keyboard focus (always on touch screens). The expanded dialog retains its toolbar.
Visuals run their local scripts immediately in an opaque iframe with no same-origin
access, popups, form submission, downloads or host bridge. Inline height follows content between 80 and 2000 pixels, with internal scrolling beyond that limit. Expanded views use a fixed viewport. View and expanded modes render the
original HTML at display resolution in the application theme; PNG previews are for
agent validation. Script failures are displayed beside the visual. Interactive controls
must be present in the generated HTML; the host does not turn every label into an
editor. State stays in memory: localStorage, sessionStorage and IndexedDB are not
available in the opaque sandbox.

CSP permits HTTP(S) resources but blocks embedded frames; desktop navigation guards
prevent the frame leaving its document. Web clients remove a frame after unexpected
navigation, but iframe CSP is not a network firewall for self-navigation. Hidden
cards unmount their frames and lose transient interactive state. Cards follow
application colors and typography through theme messages, preserving in-memory edits during theme changes. HTTP(S) links open through the host only when the frame has focus and the user has just interacted with it.

`html_preview` optionally captures a screenshot and bounded console output in a
separate, sandboxed Chrome headless shell process. First use downloads the pinned shell to the server's private tools cache. Preview admits one request at a time,
routes TCP traffic through a mandatory public-network SOCKS proxy, denies downloads,
uses a temporary profile, limits rendering to 20 seconds, and closes the process
after each request. The proxy blocks private, loopback, link-local, reserved, translated and host interface addresses; DNS results are checked and pinned to prevent rebinding. This server-side proxy applies to preview capture; displayed frames use the client browser network and permission policies. Publishing measures initial content heights at nine widths only when the preview browser is already installed, with a six-second budget; it never downloads a browser. Displaying a reply does not launch a browser.

Inputs accept exactly one inline HTML string or workspace file, up to 2 MiB.
Inline HTML also works in chats without a ready workspace; file inputs and local images require one.
Local PNG, JPEG, GIF and WebP images are embedded after canonical workspace containment
and byte checks, up to 8 MiB total; prepared documents are limited to 16 MiB. Inline
SVG is supported. Absolute HTTP(S) scripts, styles and images are supported; inline assets are preferred for predictable rendering. Local scripts and styles must be inlined. Theme variables are `--glade-background`, `--glade-foreground`,
`--glade-muted`, `--glade-accent`, `--glade-border`, `--glade-font-family` and
`--glade-font-size`. A preview can be retained only with the unchanged source and
within its originating provider session.
