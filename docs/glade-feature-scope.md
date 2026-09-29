# Glade product scope

Glade has two application identities: Dev and Prod. Prod uses `com.agent.glade`,
Dev uses `com.agent.glade.dev`. Dev uses unbadged blueprint artwork; Prod uses
production artwork. Production updates come only from the Glade release repository.

## Removed features

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
Computer Use. `computerPermissions.ts` owns permission state and guide lifecycle;
`computerHelperProtocol.ts` validates helper messages. These do not expose capture
attachment APIs or a keyboard capture watcher.

## Source Control

Review panels expose a toolbar button to switch between stacked and split diffs in one click.

Source Control shows outgoing and incoming commit counts to the left of Fetch when
the branch has an upstream. Incoming counts reflect the last fetched remote state.

History pages through commits on the current branch as the virtualized list scrolls.
Filtering searches commit messages across the branch, including unloaded pages.
Selecting a commit shows its read-only patch below the list with file diffs
initially collapsed; large patches are capped and marked partial. The detail pane
uses 60% of the available height, as does the Changes diff pane.
Commit rows offer an icon menu to copy the full hash, short hash, or subject.
History rows show author initials, relative time, and tags. Commits reachable
from the tracked remote branch have a green up arrow; newer local commits have
a yellow commit icon.
Repositories without a remote upstream show neither icon.

The right dock supports staged-only commits with a workspace-scoped message draft
and Cmd/Ctrl+Enter, AI message generation from staged changes without index or commit mutations, fetch across configured remotes, fast-forward-only pull, push of existing commits, and the
shared branch picker. Commit message generation uses the configured model, enables advertised fast mode, and disables thinking or selects the lowest advertised effort. Its 90-second deadline includes model discovery. The commit button stays aligned with the first input line. Rebase lets users choose a target branch, resolve and stage
conflicts, then continue or abort. Starting a rebase does not stash changes automatically.
File menus add selected untracked files to the repository-root `.gitignore` using
literal, rooted paths; tracked files remain tracked and existing ignore rules are preserved.

## Existing data

Migration IDs 74–78 and 80 retain only their original ledger names and no-op entries,
so existing databases can still validate their lineage. Migration 109 removes the
retired integration tables and credentials, preserving projects and conversation
history. Historical conversation creation-source metadata may still decode the
retired source value; it grants no capability and cannot create a connection.

Migration 111 deletes side chat threads and their descendants, including their runtime and
event records, then removes side chat columns. Regular conversations are preserved.

Old OS profiles and manual browser sessions are not deleted. Persisted image bytes
remain readable even when removed capture-specific display metadata is discarded.

## Completion checks

Audit implementation, registration, contracts, startup, background work, UI, search,
onboarding, assets, dependencies, docs and release scripts together.
Verify retained functionality as well as removals. Use the actual Dev launcher for
icon checks; build and verify signed artifacts from the final source snapshot.
