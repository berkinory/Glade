# TODO

- **S17 implemented:** Added scoped, transient CLI sign-in sessions, retained successful contextual model catalogs on refresh failure and optional sidebar quota windows. Full check and test suite passed; both configured provider commands exercised with isolated real PTYs. Official account sign-in and Windows execution remain unverified.

- **S11 implemented:** Added draft membership and local draft rows, open-chat reveal, profile-scoped Activity filters and bounded read watermarks, safe nested favicon discovery and unclipped resize rails. Full check and full suite passed (2,545 passing, 9 skipped); final web changes passed all 439 web tests. Isolated Dev verified local draft visibility, Settings/reload filter retention and unclipped handles. File-boundary and persistence fixtures passed; exhaustive platform/theme and closed-app live-provider scenarios remain unverified.

- **S3 implemented:** Separated native command discovery from context-meter timeout, fenced preparation/replay with durable cancellation, preserved established compaction settings and cleared missing-conversation bindings under generation/turn checks. Codex watchdog publishes actual authority retirement. Full check and full suite passed (2,543 passing, 9 skipped), including native configuration and durable cancellation coverage. Real-provider startup, Windows and signed release scenarios remain unverified.

- **S2 implemented:** Implemented canonical background-task summaries, session retirement, delayed successful completion, retained desktop notifications and app-owned background errors with inline visible errors. Full check and full suite passed (2,541 passing, 9 skipped); Windows boundary and desktop build passed, and final ordering adjustment passed 4 focused tests. Live provider and Windows Notification Center scenarios remain unverified; isolated UI verification follows the remaining groups.

- **S1 implemented:** Retained the mounted inert timeline behind details; added scroll-driven edge masks with reduced-motion and unsupported-browser handling; gave visible menus priority; added persisted effort cycling with owned picker previews; enabled Markdown image previews without nested linked-image actions; added validated internal chat fragments and context actions. Full-suite run passed server, contracts, shared, desktop and scripts; after fixing eager navigation initialization, all 434 web tests passed (2,537 passing tests across packages, 9 skipped). Format, lint, typed lint, module boundaries, server types and Windows boundary passed; global check/web types remain blocked by existing Browser imports. Isolated UI verified effort cycling, manual picker retention and menu shortcut precedence. Streaming detail return, the full fade/theme/accessibility matrix and image/chat-link activation were not live-verified.

- **S12 implemented:** Moved submission exclusion and preparation resolution into the existing thread owner; promoted preparing chats early; consumed only captured composer content and restored failures by thread; retained workspace/uploads on uncertain delivery; protected promotion and new-chat reuse; simplified project selection and added Worktree checkbox. Web tests: 430 passed initially, 24 affected tests passed after updating promotion semantics (full rerun follows). Isolated UI verified typed Up, reload, Git eligibility and keyboard toggle; retained cancellation/concurrent thread fixture passed. Slow live provider/navigation races remain unverified.

- **S14 implemented:** Reused supplied PR text; detected terminal Codex auth failures with bounded UTF-8 output and scoped teardown; moved progress ownership into each action; validated PR worktree fork/upstream before reuse, preserved returned environment and detached nonessential refresh. Git integration tests: 12 passed including real worktree reuse/conflict; process fixture auth 515 ms and recoverable fallback passed; platform boundary/server types passed. Live provider, teardown-failure and UI navigation scenarios remain unverified.

- **S8 implemented:** Added credential-scoped GitHub cooldown at existing process admission, including queued rechecks, lower-priority association lookups and explicit rate errors; shared checkout PRs survive empty/unavailable lookup. Real child-process fixture covered auth/transport/rate failures, concurrent misses, cached reads, mutations and expiry. Existing Git tests: 14 passed; server typecheck passed. Full suite follows this batch; live GitHub rate exhaustion was not induced.

- **S13 implemented:** Removed artificial readiness waits, narrowed focused metadata, reused immutable settings/activity decoding and read committed route matches. Web tests: 433 passed; check blocked by existing Browser imports. Measured work-log fixture 521.81 ms to 12.34 ms; live navigation and multiwindow checks remain unverified.

- **S15 implemented:** Excluded deleted Git paths with filesystem fallback for incomplete discovery; added safe UTF-8 download headers and client filename decoding; struck through canonical deleted rows and removed deleted-version Show file actions. Fixed the existing media import blocking Source Control. Full suite, server types, real Git fixtures, HTTP headers/bytes and Dev UI staged/unstaged/rename/partial-staging checks passed. Browser download event capture timed out, so the final saved filename and live chat export remain unverified; global checks retain browser import blockers.

- **S6 implemented:** Added microphone preparation, digital-zero warmup handling, in-turn recording beside Stop, and opt-in Enter transcription/send through the existing queue/steer owner. Current-request/thread guards and synchronous duplicate fences protect delivery. Full suite and final web rerun (433 tests) passed; isolated UI setting persistence verified. Live microphone/provider transcription remains unverified. Global checks retain existing browser import blockers.

- **S10 implemented:** Added fail-closed hosted Windows installer scanning before artifact upload, with protection/signature checks, clean output, detection history and stable hashes. Evidence uploads run on failure; publication depends on the build. Actionlint and release integrity tests passed. Windows clean/detected/inconclusive runs remain unverified; desktop build is blocked by the existing BrowserHeader LinkIcon export.

- **S9 implemented:** Added idempotent migration 2 after measuring identical 2,000-turn profile results at 411 ms before and 4 ms after; archive query unchanged, so no deletion-speed claim. UTC date formatting checked in three time zones. Migration lineage and full suite passed (2,536 tests); server types passed. Global check remains blocked by existing browser imports.

- **S4 implemented:** Windows update environment/stdin, asynchronous pinned DNS and direct POSIX root signaling are implemented. Focused HTTP/process/RPC tests pass (58); Windows boundary and lint pass. Full-suite browser timing failure passed on focused retry. Repository-wide checks have existing formatting/browser import blockers; live Windows/provider execution remains unverified.

**Target version:** 0.1.1

## Instructions for agents

- Work only on the task you were given.
- Commit only your own changes. Stage paths explicitly (`git add <paths>`), never `git add -A` or `git commit -a`.
- Do not touch, revert, reformat or "fix" other changes in the repository, including uncommitted ones from other agents.
- When your task is done and committed, mark its checkbox here.
- Add a changelog entry only when the task gives one, using that text under the target version above in CHANGELOG.md (create `## <version> - Unreleased` if it is missing). If the task has no changelog line, do not add one.

## Tasks

- [x] **T1:** Simplify General settings and the chat Environment panel
  - **General:**
    - Add icons to both Local and New worktree choices in the New threads setting, reusing the existing workspace icons.
    - Remove the Sidebar layout setting. Always use Classic and remove the Rail sidebar implementation, its state, preferences, components and references throughout the codebase. Preserve the remaining sidebar's project, space and thread functionality.
    - Remove Recently added from Project order, including its sorting implementation. Keep the other project ordering choices.
    - Remove the Thread order setting and alternative thread sorting modes. Always order threads by Recently active, including sidebar sorting menus and all other entry points.
    - Remove Sidebar sections and its visibility preference. Chats must always be visible.
    - Default Environment panel → Open by default to true. Keep the toggle available and respect an explicitly saved user choice.
  - **Chat Environment panel:**
    - Remove checkbox/completion behavior from pinned messages. Pinned entries should navigate to their message when clicked; retain pinning and unpinning.
    - Remove Project instructions entirely, including its settings, panel UI, editing/copy actions and feature-specific code and references. Keep Notepad.
  - **Cleanup and verification:**
    - Remove retired settings from schemas, defaults, reset behavior, settings search, menus and active documentation; remove feature-only code, tests and assets left unused.
    - Existing saved Rail, visibility and sorting preferences must not reactivate removed behavior. Preserve released migrations and user data.
    - Verify in the running Dev app: workspace choice icons, Classic-only navigation, project and thread ordering, always-visible Chats, the Environment panel default, pinned-message navigation and working Notepad.
    - Run `bun run check` and affected tests; use the full `bun run test` for cross-package or lifecycle changes and the required desktop/migration checks if those boundaries change.
  - **Changelog:** Improved: Settings and sidebar navigation are simpler, and pinned messages in the Environment panel jump directly to their conversation.

- [x] **T2:** Improve notification permissions and consolidate provider settings
  - **Notifications:** Show the actual desktop notification permission status. Offer the appropriate action for the platform and state: request permission when requestable, or open the relevant system settings when permission must be changed there. Refresh the status after the user returns; distinguish unavailable support from denied permission.
  - **Chat behavior:** Rename Assistant output to Streaming, including its settings search label and references.
  - **Agent Providers:** Merge Enabled Providers, Available CLIs and Provider Tools into one cohesive advanced provider configuration panel. Bring enablement, CLI availability/configuration and provider tools together while preserving their existing capabilities and actions; remove the redundant panels and duplicated controls.
  - **Verification:** Verify permission status/actions, the Streaming label and consolidated provider controls in the running Dev app. Run `bun run check` and affected tests, plus the full `bun run test` and `bun run build:desktop` when changing native notification or cross-process behavior. Report platform-specific permission behavior that could not be tested.
  - **Changelog:** Improved: Settings show desktop notification permissions and bring provider configuration into one place.

- [x] **T3:** Reorganize settings around clear names, coherent groups and consistent controls
  - **Scope and order:** Apply after T1 and T2. This task changes settings navigation, placement, copy and presentation; it must preserve the remaining capabilities and saved choices. Do not repeat T1's removals or redesign T2's notification permission logic/provider consolidation. Do not add new preferences just to support the new layout.
  - **Findings from the current implementation:**
    - `settingsNavigation.ts` divides 16 destinations into five groups, including single-item Computer, System and Archived groups. Profile actually shows local activity; Models & writing contains only Git writing model; Agent prefixes and repeated headings add noise.
    - `_chat.settings.tsx` puts file explorer, diff presentation and terminal confirmations under Chat behavior. Appearance mixes general typography, terminal typography, composer caret and time formatting without a clear hierarchy.
    - `-settingsGeneralPanel.tsx` mixes new-chat defaults, worktree cleanup, navigation and Environment content. Environment content groups can look like unrelated global settings.
    - `AdvancedSettingsPanel.tsx` separates editing the shortcuts file from the actual shortcuts page. Recovery copy repeats itself, and version/release descriptions explain obvious labels.
    - `settingsSearchIndex.ts` repeats labels independently, includes outdated provider wording and does not consistently describe the current controls. Label-derived anchors make renames fragile. Search results expose two buttons for the same destination.
    - Shared settings rows require descriptions even when the label is sufficient. Navigation already has icons; the missing work is meaningful option/action icons and consistent row layout, not adding decoration everywhere.
  - **Navigation and ownership:** Replace the five navigation groups with these three, in this order. Use the same names in navigation, page titles, search and contextual links:
    - **App:** General, Appearance, Notifications, Keyboard shortcuts, Activity, Advanced.
    - **Workspace:** Chat, Files & diffs, Git & worktrees, Archived chats.
    - **Agents:** Providers, Skills, MCP servers, Plugins, Computer use, Usage & limits.
    - Rename Profile to Activity, Chat behavior to Chat, Keybindings to Keyboard shortcuts, Agent providers/skills/plugins to Providers/Skills/Plugins, and System tools to Advanced. Use chat in user-facing copy consistently; retain technical thread/session identifiers where required by code or provider concepts.
    - Fold Models & writing and Managed worktrees into Git & worktrees with separate Git generation and Managed worktrees sections. Move Delete worktree on archive here, next to its actual cleanup scope. Do not imply that Git generation changes the model used for chat replies.
    - Move Explorer and Review controls out of Chat into Files & diffs. Keep file visibility and diff display as distinct sections within that page.
    - Keep follow-up behavior, Streaming, effort control visibility and confirmations in Chat. Separate conversation controls from a clearly named Confirmations section; use explicit chat/terminal targets in confirmation labels.
    - Keep General focused on new-chat defaults, sidebar project order and Environment panel configuration. Nest the remaining Environment content switches visibly under Environment panel, with a clear distinction between opening the panel and choosing its contents.
    - Put Open shortcuts file alongside shortcut editing in Keyboard shortcuts. Keep connection/session management, recovery, updates, version, release history, Welcome tour and Restore defaults in clearly separated Advanced sections. Preserve reset scope and confirmation safeguards.
    - Keep one editable home for each preference. Contextual links may lead there; do not copy a control onto several pages. Retain meaningful provider, chat and workspace entry points into settings.
  - **Names and descriptions:** Audit every visible page title, section title, row, option, tooltip, empty state and action, including platform-specific rows. Use sentence case and a consistent noun/action vocabulary.
    - Prefer labels that say what changes: Activity toasts → In-app notifications; Base font size → App font size; Use system UI font → Use system font; Caret style → Composer cursor; Git writing model → Git generation model; Delete confirmation → Confirm before deleting a chat; Archive confirmation → Confirm before archiving a chat; Terminal close confirmation → Confirm before closing a terminal.
    - Name the effort visibility toggle Show effort control. Describe when to use it, without explaining menu rows or internal placement. Keep Streaming as established by T2.
    - Give unclear choices short, practical explanations. For Queue versus Steer, explain waiting for the current response versus redirecting it; retain the opposite-action keyboard shortcut as a concise hint.
    - Make descriptions optional in the shared row primitive. Omit obvious text such as Current application version; normally use at most one short sentence for purpose or consequence. Remove repeated page/section/row descriptions and decorative eyebrow text that merely repeats the heading.
    - Keep essential consequences visible: deletion scope, reset scope, permission requirements, whether a change affects running chats, and whether a provider operation applies to one chat or the provider runtime. Put file precedence, executable paths, backend details and troubleshooting explanations in relevant advanced disclosures.
    - Do not call quota displays billing settings or advertise unavailable controls. Use installed, enabled, authenticated and loaded only for the actual state each represents.
  - **Layout and interaction:**
    - Reuse existing settings primitives, icons and disclosure motion. Standardize control widths, row alignment, spacing, section actions and reset placement; avoid empty description/reset gutters. Keep labels and controls usable at narrow widths and larger configured text sizes with `text-ui` tokens.
    - In Appearance, group theme/window appearance, interface typography/layout, terminal typography, composer cursor and time format coherently. Keep computer-specific visual options in Computer use, close to the feature they affect.
    - Use segmented choices for short mutually exclusive options, selects for longer lists, switches for booleans and buttons for actions. Preserve accessible labels, keyboard operation, focus visibility and explicit units for numeric controls.
    - Add icons only where they aid recognition: workspace choices from T1, provider identity, open-folder/open-file/external-settings actions and relevant visual choices. Reuse existing assets; do not attach a different decorative icon to every switch. Icons must not replace accessible text.
    - Present dependent settings together and explain a disabled control's prerequisite locally. In Computer use, make automatic preview and preview size distinct, clearly named controls. Keep permission state and stopping computer control readily visible; collapse backend diagnostics.
    - Refine T2's consolidated provider panel with a clear provider identity, availability/status and primary controls, then advanced configuration. Keep enabling a provider distinct from showing it in the picker; preserve ordering, update and CLI-path controls without duplicate panels.
    - Align the shared provider/project/chat context controls used by MCP servers and Plugins. Make the selected scope and operation consequences visible before actions. Do not imply that installed plugins are loaded, or that all providers support identical operations. Keep Skills, MCP servers and Plugins distinct capabilities.
    - Use concise, consistent loading, empty, error and unavailable states. Keep actionable errors and retry/refresh controls; unsupported capability must not appear to be an off preference.
  - **Search and navigation integrity:**
    - Update the search inventory for all current visible controls, including file visibility and diff colors, and remove T1/T2's retired entries. Keep useful old names as search keywords only, not visible duplicate settings.
    - Give moved/renamed searchable rows explicit stable targets using the existing target mechanism. Do not derive their identity from display copy. Reuse navigation metadata where already shared; do not build a new settings registry framework.
    - Render each search hit as one keyboard-focusable result with its destination as secondary context. Selection must navigate, scroll to and visibly identify the actual control. Preserve Enter and Escape behavior.
    - Inspect existing links and persisted navigation before changing section IDs; update real callers and handle existing destinations where needed. Preserve saved preference values and per-setting reset behavior; cosmetic renames do not justify renaming storage keys or resetting user choices.
  - **Acceptance and verification:**
    - Verify in the running Dev app, after T1/T2: all three navigation groups, the moved controls, notification permission actions, provider scope/actions, search navigation, per-setting reset and whole-settings reset. Use an isolated profile for destructive reset verification.
    - Check narrow/wide settings layouts, increased app font size, keyboard-only operation and reduced motion. Verify that platform-specific/unsupported controls and loading/error states remain understandable. Report any platform behavior not exercised.
    - Confirm that each remaining preference has one editable location, obsolete labels are absent from visible UI, search results reach the correct setting and existing saved values survive the reorganization.
    - Update active docs and contextual links. Run `bun run check` and affected existing tests; use the full `bun run test` and desktop checks if implementation crosses those boundaries. Do not add snapshots or source-text tests to freeze the new labels/layout.
  - **Changelog:** Improved: Settings are easier to navigate, with clearer names, related controls grouped together and more useful search.
