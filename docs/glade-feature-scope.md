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
  or automatic thread naming and deletion. Sidebar and in-thread terminals remain available.

These are physical removals, not dormant implementations behind feature flags.

## Shared Computer functionality

`apps/desktop/native/computer` provides the permission guide, permission checks,
input release, Escape monitoring, activation shield and preview frame tap used by
Computer Use. `computerPermissions.ts` owns permission state and guide lifecycle;
`computerHelperProtocol.ts` validates helper messages. These do not expose capture
attachment APIs or a keyboard capture watcher.

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
