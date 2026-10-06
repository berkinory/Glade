# Providers

Glade does not host models or sell a separate model subscription. It operates supported
coding-agent runtimes installed and authenticated on your machine, then presents them through one
consistent workspace.

## Supported providers

| Provider    | What Glade connects to                                       |
| ----------- | ------------------------------------------------------------ |
| Claude Code | Your installed Claude Code runtime and authenticated account |
| Codex       | Your installed and authenticated Codex CLI                   |

Use provider settings to check installation and authentication status. Glade requires Codex 0.158.0 or newer and Claude Code 2.1.267 or newer. An older runtime shows Update required and cannot start a session.

## What Glade manages

Glade provides the shared operating surface around each provider:

- Project and task ownership
- Provider and model selection
- Conversation and tool activity
- Approvals and user-input requests
- Terminal, browser, file, and diff surfaces
- Git environments and checkpoints
- Session continuation where supported
- Provider handoffs
- Usage information where the provider exposes it

## What remains provider-owned

The provider still controls:

- Installation
- Authentication
- Account and subscription limits
- Model availability
- Tool behavior
- Permission semantics
- Service availability
- Provider-specific session features

A provider working in its own terminal is an important prerequisite, but not a guarantee that every
provider feature is supported through Glade.

## Runtime activity and background replies

Runtime warnings keep up to 2,000 characters of their sanitized explanation in the activity details; only the row preview is shortened. Claude's available readable thinking uses stable message/block identities and bounded updates, with streaming and snapshot text reconciled into one activity per block. Empty or encrypted thinking remains hidden. Glade does not request additional reasoning from the model.

Approval explanations, tool-progress summaries and background-task completion or failure details retain up to 2,000 characters for the existing detail view, while activity rows keep concise previews. Tool-progress data uses the existing 16,000-character JSON budget. Approval parameter credential redaction remains in place. These details stay attached to their original task and session.

Claude tool summaries follow their associated tools. Native retry notices report the supplied attempt, delay and HTTP or connection status. Sign-in activity replaces its earlier session status and can appear before a turn starts; raw sign-in output, tokens and credential-bearing links are excluded. A finished sign-in operation is not a claim that account authentication succeeded.

A parent reply started after background work gets its own response boundary and work clock, even without another user message. Earlier final replies, copy actions and checkpoints remain available. Owned background tasks keep the foreground work section open and show a waiting status until they settle. Successful completion notifications still wait for all owned background work; stopped or replaced sessions cannot revive it. Activity updates and waiting indicators do not drive transcript auto-follow.

## Conversation titles and history

Glade generates a title once, in the background, from the first user message containing at least
three letters or numbers. Short or punctuation-only messages defer generation until a meaningful
message arrives. Only one title request runs at a time, without delaying the chat response.
The separate request contains no conversation history, repository instructions,
skills, or MCP servers. Codex uses a temporary thread in the chat's existing app-server process;
Claude uses a short-lived CLI request. Codex prefers `gpt-6-luna`; Claude prefers `claude-sonnet-5-5`. If that model
is unavailable, Glade uses the triggering message's model with the lowest supported effort other
than `none`. A short message-based title remains visible if generation fails.

Manual renames always win over generated titles. Native title notifications do not replace a title
owned by Glade. Renaming a chat also renames its native session; a rename made before the session
exists is applied when the provider first supplies a title. Use `/rename <title>` to choose your own.

Deleting a chat also deletes its Codex or Claude session history. Codex chats archive and unarchive
in Codex too; Claude has no native archive operation, so archiving stays local. If native deletion
fails, Glade still deletes the chat and records the failure in the server log without retrying it.

## Connect a provider

1. **Install the official runtime.** Use the provider's official installation instructions.
2. **Authenticate outside Glade.** Complete the provider's normal sign-in or credential setup.
   Verify the runtime from a fresh terminal.
3. **Open Glade provider settings.** Confirm that the provider is detected and enabled. When
   necessary, configure a custom path to the provider executable.
4. **Check model discovery.** Open the model picker and confirm that the expected models and options
   appear. Glade discovers many provider capabilities at runtime; the result can depend on the
   installed CLI version, account, subscription, and provider configuration.
5. **Start a small test task.** Use a harmless objective in a test repository before relying on a
   newly configured provider for important work.

## Models and effort options

The installed provider supplies model IDs, names, defaults and available options. Glade does not ship a selectable model catalog. **Provider default** leaves model selection to the runtime. Each option can inherit the provider default or keep an explicit selection, including an explicit off setting.

Claude aliases and context variants retain their native IDs. Codex reasoning effort and service tiers follow its model discovery response. Claude effort, fast mode and adaptive thinking appear only when native model metadata advertises them. Live Claude effort and speed changes no longer require a separate model-profile restart. User-written Ultrathink text is sent unchanged; Glade does not insert a prefix.

Discovery shares a saved catalog across chats using the same executable, endpoint, account and native settings. New workspaces show that catalog immediately while Glade checks their provider configuration in the background. A workspace keeps a separate catalog only when its models or options differ. Glade warms catalogs at startup and refreshes them on window focus, native settings or account changes, and while discovery is stale. A failed refresh can retain a catalog from the same context; a saved model that has disappeared remains saved and is shown by its ID. With no usable catalog, the picker shows loading or the discovery error rather than a static fallback.

The composer model picker has one tab per connected provider and a Starred tab. Starring a model
saves it together with its current effort and speed, so one click (or `mod+1`…`mod+9` while the
picker is open) restores the whole combination. A task that has started stays on its provider: only
that provider's tab and starred entries are offered. Supported provider executables can be pointed
at custom binary locations.

Starred models absent from the current catalog remain saved and can be removed, but cannot be
selected. They become selectable again when provider discovery adds them to the
catalog.

## Provider sessions

Each task owns a provider session.

The session may preserve provider-specific behavior such as:

- Plans
- Tool calls
- Approvals
- Reasoning summaries
- Context usage
- Model changes
- Resume or reconnect behavior
- Provider-native subagents or workflows

Capabilities vary. Do not assume a control available for one provider exists for all of them.

### Native subagents

Provider-assigned names are preserved. Claude task descriptions are kept in task details; helpers without a native name receive a stable Glade name derived from their identity. Compact rows show the name and reported model or requested alias without agent-type suffixes or task prompts. Requested aliases do not establish which exact model version ran.

Ask for delegation and any per-task model/thinking choices in the main chat using ordinary language. The main agent decides which work benefits from delegation and uses the selected provider's native tools. Supported choices depend on those tools and native agent profiles; an explicit request does not prove the setting was applied.

Open subagents from the in-chat strip or **Environment → Subagents**. Helpers leave these panels as soon as their work completes, fails or stops. Running, queued and approval/input-blocked helpers stay visible. Hiding a helper does not delete its sidebar entry or transcript; historical tool rows still open it, and using it again restores it. Reply notices show the originating helper’s avatar and name and open its transcript while it remains available. Both surfaces open the same transcript. Send follow-up instructions to the main chat; subagent transcripts are for following work and handling native approval or input requests. Steering the main chat does not stop its children. Explicit Stop follows native cancellation and session shutdown. Background and individual stop actions appear only where the adapter supports them.

### Claude context and compaction

Glade displays context usage reported by the active Claude runtime. If the runtime has not reported a
usable window or token count, the meter leaves that value unknown. Claude Code owns its context
window and automatic compaction settings, including any model variants it advertises. Glade does
not override those settings when starting or resuming a session.

The context popover offers **Compact now** when the installed runtime supports `/compact` and the
task is idle. This sends Claude's native command with the current model and settings. It processes
the existing conversation once, and later turns use its summary. Glade does not compact in the
background or pause a send to ask for cache approval.

Claude Code also owns prompt caching. Resuming a conversation restores its history but does not
restore an expired server-side cache. An unchanged prefix may still be reused while the provider's
cache remains valid. See Anthropic's
[prompt caching documentation](https://code.claude.com/docs/en/prompt-caching) and
[context configuration](https://code.claude.com/docs/en/model-config#context-window-and-auto-compaction).

### Claude Artifacts, `/design` and `/slides`

Claude Code keeps [Artifacts](https://code.claude.com/docs/en/artifacts) off by default for Agent
SDK sessions, so `/design` and `/slides` cannot publish until the host opts in. Turn on **Settings →
Providers → Claude → Artifacts, /design and /slides** and start a new session; Glade then launches
Claude with `CLAUDE_CODE_ARTIFACT=1`. Claude's own requirements still apply: a claude.ai login on a
Pro, Max, Team, or Enterprise plan, Claude Code 2.1.234 or later, and an organization policy that
allows Artifacts. While Artifacts are off or unavailable, the composer marks both commands with a
warning that explains what is missing. Published pages are hosted on claude.ai; Claude returns the
link in its reply.

## Native tools and extensions

**Settings > MCP servers** shows native server status for the selected provider, workspace or active session. Supported actions include authentication, reconnect, enable/disable and scoped configuration changes. Claude enable/disable applies only to the selected session; persisted changes apply to a later session. Codex reconnect reloads its provider MCP runtime. Concurrent Codex configuration edits require a refresh rather than overwriting a newer native configuration. The managed Glade gateway cannot be removed or disabled here.

**Settings > Plugins** separates installed plugins from plugins loaded in the selected session. Claude changes use the native CLI and reload API. The Codex plugin library retains marketplace and detail views. Native reload failures remain visible even when installation succeeded.

Shared skills load through each provider's native loader. Claude uses a local skills-only plugin bridge that links the original folders, preserving bundled resources; Codex receives additional native skill roots. Skill contents are not pasted into outgoing prompts. Claude enablement controls apply to Glade sessions, with changes taking effect in a new session. The allowlist governs Skill tool invocation; it does not restrict filesystem access through other tools.

## Switching providers

To switch providers in an existing task, select a model from another provider in the model picker
and confirm the [handoff](https://github.com/berkinory/Glade/blob/main/docs/core-concepts.md).
Glade creates a new task with the same working environment and imported conversation context.

Use handoffs deliberately. Review the working tree before and after changing providers so ownership
remains clear.

## When a provider is missing

Check these in order:

1. Does the executable run from a fresh terminal?
2. Is the provider authenticated?
3. Is the expected executable on `PATH`?
4. Is a custom binary path configured incorrectly?
5. Does the installed runtime version support the required integration?
6. Does restarting Glade refresh the provider status?
7. Does the provider itself report a service or account error?

Continue with the [troubleshooting hub](https://github.com/berkinory/Glade/blob/main/docs/diagnostics.md) when the
runtime works independently but remains unavailable in Glade.

Use the official provider documentation linked in Glade's provider settings for exact installation,
authentication, update paths, and provider-specific failure checks.

## Cancel a blocking question

Blocking questions show **Cancel** whether or not they offer choices. Cancel applies to
the whole pending request, including any later questions in the same set. Once an
answer or cancellation is being submitted, the form disables Cancel until the
request settles.

## Codex asynchronous questions

On Codex versions and models that expose `request_user_input_async`, Glade shows
a question-mark capsule labeled with the number of questions. Opening it reuses
the same question form as blocking prompts: numbered choices, previous/next
navigation, and a separate text answer. Closing the capsule preserves the current
answer draft. A suggested answer is never submitted automatically. The composer
remains available and the agent can continue working while the question is unanswered.

The shared form keeps blocking prompts' existing auto-advance behavior. Async
questions require an explicit submission and scope keyboard shortcuts to the
opened form, so separate questions and the main composer cannot consume each
other's input.

Questions and submitted answers are stored with the assistant message. Refreshing
or restarting Glade restores that state. Concurrent submissions are admitted once
by the server; a second client refreshes the accepted answer. Normal turn-delivery
errors remain visible on the conversation, as for any other user message.

Rolling back a turn or reverting a checkpoint that removes an answer reopens its
question. Formatted question replies do not offer plain-text edit-and-resend, so
the capsule and the submitted message cannot show different answers. Answer updates
preserve the original assistant message's completion time and turn summary.

### App-server protocol

Verified with codex-cli **0.154.0**, its generated experimental TypeScript schemas,
and an isolated native app-server session:

- `request_user_input_async` is a model-facing tool, not a client RPC. It emits
  `item/started` and `item/completed` for an `agentMessage` with
  `delivery: "async"` and `questions: [{ title, options }]`, and immediately
  returns to the agent. `options` may be null for a free-text-only question.
- The answer is an ordinary user message containing the questions and answers.
  Glade uses its existing turn dispatch: `turn/steer` with `expectedTurnId` while
  a turn is active, and `turn/start` once the turn has finished. The existing
  dispatch path also handles the turn finishing while the answer is being sent.
- This differs from `item/tool/requestUserInput`, which carries a JSON-RPC request
  ID and uses a response with an answer map. Its `isBlocking` field and deprecated
  `autoResolutionMs` do not define the native asynchronous tool's answer path.
  The inline asynchronous cards never enter Glade's pending approval/input queues.
- Glade does not force a model or enable experimental model features. Older
  app-server versions retain their existing text and blocking-question behavior;
  malformed structured questions fall back to the provider's message text.

Scope: native Codex questions in a top-level conversation. Other providers and
subagent question routing are outside this implementation.

Sources: [OpenAI app-server documentation](https://developers.openai.com/codex/app-server),
[upstream asynchronous tool handler](https://github.com/openai/codex/blob/b0d95427c2443e90998f48065902309187564085/codex-rs/core/src/tools/handlers/request_user_input_async.rs).

## Passive results from delegated tasks

An authenticated agent can pass `notifyCreatorOnComplete: true` to
`glade_create_thread`, or on individual entries in `glade_create_threads`.
The default is off. The destination is always the authenticated creating task;
there is no destination-ID parameter, and the new task remains standalone.

Glade persists one result for the initial message/run when it completes, fails,
or is interrupted. The creator sees an attributed activity with the child and
run IDs, up to 2,000 characters of final response (with truncation indicated),
and a `glade_read_thread` reference for the full result. Delivery does not start,
queue, steer, or interrupt a creator turn, and does not update human-message
recency. The result is supplied as untrusted reference context on a subsequent
human-started turn; rejected sends retain it, retries keep their assignment, and
uncertain sends remain held by the existing delivery-reconciliation mechanism.
Context is bounded to 16,000 characters per send, so larger fan-outs drain over
subsequent human turns. Native control commands, reviews, and steering do not
consume completion context.

This option covers only the initial delegated run. Approval/question waits and
provider idle alone are not completion. Later conversational turns do not
produce further notifications. External integrations cannot opt in because
they have no authenticated creating task.

Delivery survives restart and duplicate events. An archived or deleted creator
is not reopened; the result remains in the child and delivery is recorded as
unavailable. Delivery is checked approximately once per second.

Context compaction uses the server-side `thread.compact` command for both providers. The server rejects archived conversations, active turns, pending approvals or input, and active background tasks. Claude forwards optional instructions to native `/compact`; the pinned Codex protocol accepts only the thread identifier, so optional instructions are ignored for Codex. Completion comes from native compaction events. Current Codex runtimes emit a context-compaction item and finish its native turn; terminal turn events release the compaction guard even when the legacy `thread/compacted` notification is absent.

### Background work and errors

When native task events identify background agents, the sidebar and composer keep
their remaining work visible after the foreground reply. Completion notifications
wait for the last relevant task to finish successfully. Failed, interrupted and
retired-session work never produces a success notification; starting another turn
does not inherit an older turn's unfinished task count.

Native child chats stay quiet: their completion, attention, terminal and error events do not produce toast, desktop or sound notifications. Open a child transcript from its avatar row and use Back to main chat to return.

New errors in other main chats appear as persistent, copyable notifications that open
the affected chat. Errors in the visible chat remain beside its message input.
Reconnecting does not announce historical errors again, and dismissing a background
notification does not erase the chat's error.

Desktop notifications retain their chat action after delivery. Windows notification
objects stay retained after a toast timeout because Notification Center can still
activate them; retention is bounded and cleared when Glade exits.

Claude compaction waits up to 15 seconds for native command discovery; a discovery
timeout is retryable and is distinguished from a runtime without compaction. Both
typed `/compact` and the menu command use the established session configuration.
Pending composer model and access choices apply to the next ordinary message.
Compaction preparation observes durable stop, archive, delete and history-change
requests before native delivery, including after restart. Uncertain native delivery
is never automatically resent.

A terminal Claude missing-conversation error clears the broken resume binding before
queued work drains. Generation and native-turn checks prevent old failures from
clearing a newer session. The transcript remains available for fresh-session context.
When the Codex watchdog actually retires gateway authority, its terminal event asks
the existing lifecycle owner to renew the connection on the next send.

### Sign-in and usage indicators

Installed Claude and Codex offer **Sign in** in provider settings. The embedded
terminal runs the configured CLI in its provider environment. Close sign-in to stop
and discard the attempt; reopening a retained running or exited attempt shows its
current state. Credentials remain managed by the official CLI. Authentication has
to be verified by provider status even when the command exits successfully.

Usage settings can show either provider in the sidebar, with five-hour, weekly or
both windows. With both selected, the outer track is five-hour and the inner track
is weekly. Hover or click opens the shared usage panel, including banked reset
details and actions when available. Keyboard users can open it with Enter.
Missing or failed windows remain unavailable rather than appearing as full quota.
Disabled providers are hidden. These controls reuse the shared usage query.

When Codex reports banked resets, usage panels keep the available count visible in a
compact **Banked resets** section. Expand it to inspect expiry information and use a
reset. Spending a reset requires confirmation and checks the current account and
usage first. Confirmation, pending requests and unconfirmed results remain visible
when the details are collapsed. Reopening the panel retains an unconfirmed attempt;
**Retry reset** checks that same attempt rather than spending another reset.

A failed model refresh keeps the last successful native catalog for the exact
provider, executable, endpoint, workspace and credential context. A successful empty
catalog remains authoritative; a new context does not inherit another context's list.

## Glade agent tools

Glade injects its authenticated MCP gateway into provider sessions. Inputs are validated
against the published tool schemas before handlers run. Tools operate under the caller's
thread identity; mutations require authority for that exact active turn.

- `glade_list_threads` returns 20 conversations by default, at most 100. Follow its
  `nextCursor` with the original filters. Ordering uses update time and thread identity;
  conversations updated between pages can move to an earlier page. Project listing does
  not hydrate conversation history.
- `glade_create_thread` and `glade_create_threads` require an explicit `target` containing
  provider and model, discovered through `glade_capabilities`. Options inherit settings
  when omitted. Worktrees use `baseRef`; legacy creation arguments are rejected.
- `glade_read_turn_diff` reads a checkpoint range; `glade_read_thread_diff` reads cumulative
  changes against the thread baseline. `glade_read_thread` exposes checkpoint counts and
  message fork eligibility. Diff pages include whitespace changes by default and use
  character offsets plus a content version; follow `nextOffsetChars` until null.
- `glade_list_dev_servers` reads managed runs. `glade_run_dev_server` and
  `glade_stop_dev_server` operate on the caller's project and workspace and require
  full-access mode. Identical runs are reused; a different run must be stopped explicitly.
  Process status is not HTTP readiness. These tools do not control unmanaged servers.
- `glade_fork_thread` preserves native history at a completed assistant message. It
  inherits the source model, permissions and workspace and creates an idle conversation;
  messaging and waiting remain separate operations. Reuse the same `requestId` and fork
  point after an ambiguous response. Forks cannot exceed caller authority.
- `glade_open_in_app` opens a workspace file, current/turn diff or terminal in the caller's
  conversation. Files accept a one-based line. A connected UI acknowledges navigation and
  presentation state; success does not guarantee content loading. Paths cannot escape the
  workspace, including through symlinks. Opening a terminal does not execute a command.

The desktop control module and provider handoff workflow are separate from these tools.
