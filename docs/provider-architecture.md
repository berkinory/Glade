# Provider architecture

Glade treats provider integrations as adapters behind server-owned orchestration and discovery boundaries. The web app does not talk to coding-agent runtimes directly: provider operations enter the server through the typed contracts in `@glade/contracts`. Session and turn lifecycle calls route through `ProviderService`; model, agent, skill, command, and plugin discovery routes through `ProviderDiscoveryService`; both ultimately resolve concrete `ProviderAdapter` implementations from the registry. Voice operations may access the registry directly where the provider capability is itself the boundary.

## Implemented providers

`ProviderAdapterRegistryLive` currently registers two first-class provider kinds:

- `codex`
- `claudeAgent`

The registry is intentionally small. It maps `ProviderKind` to an adapter and lists the registered providers; it does not own session routing, persistence, or cross-provider orchestration.

## Adapter contract

`apps/server/src/provider/Services/ProviderAdapter.ts` is the provider boundary. Every adapter exposes the same core lifecycle:

- start, list, inspect, stop, and interrupt sessions;
- send turns and, where supported, steer an active turn;
- answer approvals and structured user-input requests;
- read and roll back provider thread state;
- stop all resources owned by the adapter;
- emit one canonical `ProviderRuntimeEvent` stream.

Optional methods advertise richer native behavior without forcing every provider to emulate it. These include native review, task stop/backgrounding, subagent steering, compaction, thread forking, runtime model/agent discovery, skills, slash commands, plugins, and voice prewarm/transcription.

Adapters also expose explicit capabilities rather than making the UI infer support from provider names. Current capability flags cover session model switching, conversation rollback strategy, skill/plugin discovery and mentions, native slash-command discovery, runtime model lists, turn steering, and live diff patches.

Provider runtime-event ingress is bounded. Effect-stream producers can be backpressured by the downstream queue, but callback-style native producers cannot always be paused synchronously. Those adapters use bounded callback ingress with explicit overload outcomes such as dropped events, terminal-event eviction, or terminal overflow rather than allowing unbounded process-memory growth. Adapter implementations must therefore preserve terminal-event guarantees and handle their ingress overflow policy deliberately.

## Runtime flow

A normal provider-backed turn follows this path:

1. The client dispatches an orchestration command through the typed server API.
2. Orchestration persists the intent and `ProviderCommandReactor` performs the provider-side operation.
3. `ProviderService` resolves the thread's provider/session and routes lifecycle calls through `ProviderAdapterRegistry`.
4. The concrete adapter translates the request into its native protocol or CLI.
5. Native output is normalized into canonical `ProviderRuntimeEvent` values.
6. `ProviderRuntimeIngestion` converts those runtime events back into durable orchestration commands/events.
7. Projection streams update the shell/thread read models consumed by the web app.

Discovery follows a parallel read path: RPC handlers delegate provider model, agent, skill, command, and plugin queries to `ProviderDiscoveryService`, which resolves the relevant adapter and optional capability without creating a session lifecycle dependency.

This separation is important: orchestration does not consume arbitrary native protocol frames. Provider-native information crosses the adapter boundary only through controlled canonical fields such as `providerRefs`, opaque resume cursors, selected thread identifiers, and the sanitized/raw diagnostic envelope carried by runtime events. Those fields exist where orchestration or recovery needs native identity while the rest of the protocol and subprocess behavior remains adapter-owned.

## Native boundaries

Codex protocol artifacts come from the pinned 0.158.0 CLI. `bun run --filter @glade/cli generate:codex-protocol -- --check` verifies reproducible generation. JSON Schema validates known native responses, notifications and server requests at ingress; unknown notifications are skipped, while unknown requests receive a method-not-found response. Model and MCP discovery follow native cursors.

`provider/core/compatibility.ts` owns the admission baseline. Claude uses the configured executable resolved against its child environment, with no bundled CLI fallback. Codex launch passes managed MCP and shell-secret exclusions as native arguments while leaving the user's provider home and configuration files authoritative.

Codex chat and discovery sessions lease one app-server per executable, provider home, launch arguments, extra skill roots and effective environment. The pool owns the transport, global request IDs and native thread routing; session state and gateway authority remain separate. Gateway credentials are supplied in each thread's MCP HTTP configuration, never in the shared process environment. Resume reloads that configuration before the thread becomes ready.

Shared Codex process stderr is logged once as process diagnostics, without attributing it to chat sessions. Native protocol errors retain their thread routing, while process failures still reach every affected session.

Stopping a session interrupts its active turn and unsubscribes its native thread. Other leases keep the process alive; the last lease tears down the complete process tree and awaits exit proof. Shared crashes close all affected sessions and apply bounded restart backoff. The existing provider idle timeout still retires chat leases. Native Codex retains unsubscribed thread contexts according to its own lifecycle and creates configured MCP clients per thread, so sharing the app-server does not promise a shared MCP child process.

Model selections name native models. Unset and legacy default selections resolve through live discovery: Codex uses `isDefault`, and Claude uses the `resolvedModel` of its hidden `default` entry. Native descriptors own model options; shared code retains legacy selections without guessing model-family capabilities. Claude applies acknowledged live flags, and native context usage replaces Glade budget overrides. Historical cache-review records remain readable only for explicit held-message recovery.

`ProviderManagement` owns validation and protects managed gateway configuration before routing native MCP/plugin actions to adapters. Its contracts keep session-only actions distinct from persistent changes. Native failures retain their kind and retry state; an upstream retry without an attempt count does not acquire an invented counter. Codex account limits come from native account APIs instead of an undocumented HTTP endpoint or credential refresh implementation.

## Provider-specific state

Provider configuration is split across typed server settings, discovery/health services, and adapter start options. A provider integration may contribute:

- binary/config-path settings;
- health and authentication probes;
- runtime model, agent, skill, command, or plugin discovery;
- provider-specific model options and runtime modes;
- session resume cursors and native thread identifiers;
- handoff support;
- provider update metadata.

Capability and discovery data should be authoritative. UI surfaces should consume the shared provider metadata instead of hard-coding behavior from `ProviderKind` where a capability exists.

## Adding a provider

A new first-class provider normally needs changes across several boundaries:

1. contracts/shared provider metadata and model/options types;
2. a server adapter implementing the required `ProviderAdapter` lifecycle;
3. registry/runtime-layer wiring;
4. health/auth and, when applicable, update/discovery support;
5. persistence/model-selection compatibility;
6. web settings, provider/model picker metadata, icons, and model-picker handoff confirmation;
7. focused adapter tests plus regression coverage for lifecycle, interruption, resume, approvals, and event normalization.

Prefer capability-driven behavior and existing shared protocol helpers. Do not add provider-specific branches to orchestration when the difference can stay inside the adapter.

## Related code

- `apps/server/src/provider/Services/ProviderAdapter.ts` — adapter contract and capabilities
- `apps/server/src/provider/Layers/ProviderAdapterRegistry.ts` — concrete provider registry
- `apps/server/src/provider/Layers/ProviderService.ts` — session-aware lifecycle routing
- `apps/server/src/provider/Layers/ProviderDiscoveryService.ts` — model/agent/skill/command/plugin discovery routing
- `apps/server/src/provider/core/boundedCallbackIngress.ts` — bounded callback-producer ingress policy
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` — orchestration intent to provider calls
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` — provider events to durable orchestration
- `packages/contracts/src/core/baseSchemas.ts` — provider kinds and entity identifiers
- `packages/contracts/src/provider/sessionPolicy.ts` — model selections, runtime modes and provider policy
- `packages/contracts/src/provider/runtimeMetadata.ts` — provider references, lifecycle states and event identity
- `packages/contracts/src/provider/runtimePayloads.ts` — provider payload and workflow schemas
- `packages/contracts/src/provider/runtimeEvents.ts` — provider event schemas and their canonical union
- `packages/contracts/src/orchestration/threadEntities.ts` — durable session, thread and turn contracts
- `packages/shared/src/provider/providerMetadata.ts` — shared provider metadata

Glade renders harness policy once per provider. Codex receives it as `developerInstructions` on thread start, resume and fork; no collaboration-mode payload is sent. Claude receives the same policy through the preset system prompt append. Local probes with Codex 0.158.0 and Claude 2.1.283 confirmed the marker, Computer Use rules and gateway rules in model-visible instructions. The retired Codex collaboration-mode channel did not deliver them.

Edit, revert and file undo preview scoped checkpoint restores before confirmation. Each removed turn contributes its git diff paths, with the first affected turn start as the restore target and the last affected turn end as the expected workspace state. Later file changes require explicit consent per path, and a fingerprint is revalidated before provider rollback and again before restoring. The real git index and unrelated files are preserved. Claude rollback starts its replacement native session before deleting the superseded history.

Claude agent discovery uses only the SDK’s `supportedAgents()` results. The SDK exposes name, description and model, without the originating configuration file path, so Glade does not fabricate an “open agent file” action. Claude child-message delivery uses its existing `PreToolUse` hook and the composer states that delivery occurs at the next tool call. Native task messages own lifecycle and progress. The isolated `claudeWorkflowRuntime.ts` reader remains because workflow child model and effort metadata are absent from those task messages.

## Guided authentication

Provider settings start the configured official Claude or Codex CLI through an
explicit authentication service. It reuses provider environment builders, platform
executable planning and the runtime PTY adapter. Each provider owns at most one
attempt, with a random attachment identity, bounded transient output and retained
exit status. Authentication output never enters chat events or terminal log storage.

Opening an existing attempt attaches to its actual executable/home and status;
only an explicit start creates a process. Close requires the current attachment
identity and verifies owned process teardown. Renderer remounts do not start another
login. CLI exit triggers provider status and catalog refresh; exit code zero alone
is not proof of authentication. Server shutdown disposes retained attempts.
