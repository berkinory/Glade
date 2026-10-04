# Architecture

Glade is a local-first orchestration application with three main runtime surfaces:

- the React web client in `apps/web`;
- the server/runtime in `apps/server`;
- the Electron desktop shell in `apps/desktop`.

The server owns durable orchestration, provider sessions, Git/worktree state, terminals, device/browser integrations, and the typed HTTP/WebSocket RPC surface. Provider-native protocols stay behind adapter boundaries; the web app consumes Glade contracts rather than talking to coding-agent CLIs directly.

```text
┌──────────────────────────────────────────────┐
│ apps/web                                     │
│ React UI · wsTransport · client stores       │
│ shell/thread subscriptions · editor/dock UI  │
└───────────────────┬──────────────────────────┘
                    │ typed HTTP/WebSocket RPC
┌───────────────────▼──────────────────────────┐
│ apps/server                                  │
│ wsRpc / HTTP routes                          │
│ OrchestrationEngine + projections            │
│ ProviderService + ProviderAdapterRegistry    │
│ Git · terminals · workspace                  │
│ browser and device integrations               │
└──────────────┬───────────────────────┬───────┘
               │                       │
       provider-native protocols       │ SQLite / filesystem / Git
               │                       │
┌──────────────▼────────────────┐      │
│ Codex / Claude / Cursor / ... │      │
│ provider adapters and CLIs    │      │
└───────────────────────────────┘      │
                                      ▼
                              durable local state

┌──────────────────────────────────────────────┐
│ apps/desktop                                 │
│ Electron shell · backend supervision         │
│ native window/OS integrations                │
│ loads the same web client                    │
└──────────────────────────────────────────────┘
```

## Runtime boundaries

### Web client

`apps/web` renders the application and owns browser-side transport/state coordination.

Important boundaries include:

- `wsTransport.ts` — connection state, negotiation, reconnect, and request transport;
- `wsNativeApi.ts` / `nativeApi.ts` — typed client API exposed to the rest of the UI;
- `routes/__root.tsx` — application-level event/subscription routing and shell/thread projection ownership;
- Zustand/React Query stores that cache or project server-authoritative state;
- client-owned persisted UI state such as unsent composer drafts, sticky local model choices, and right-dock layout, which is not reconstructible from server snapshots.

The client does not own provider session truth or durable orchestration state. When the socket reconnects, snapshots and resumable streams rebuild server-derived client projections, while browser-persisted drafts/layout remain a separate client-owned state class.

### Server and RPC surface

`apps/server/src/server/ws/wsRpc.ts` is the main typed feature-RPC boundary. It merges the shared contract groups, applies request/stream admission, authentication/session context, and exposes orchestration plus server services on one feature socket.

`apps/server/src/orchestration/decider.ts` routes each command to its owning handler in `commandDecisions`. Shared event construction and thread configuration calculations stay separate from domain decisions; the handlers preserve invariant checks and emitted event order.

`apps/server/src/server/http/http.ts` composes HTTP routes in their established order. Authentication routes, request authorization, bounded body decoding, file/upload routes, static client serving, icons, thread export and lifecycle endpoints have direct domain modules. Shared HTTP response policies remain separate from route orchestration.

The HTTP/WebSocket layer also owns:

- protocol negotiation and compatibility fencing;
- trusted-origin/authentication policy;
- static asset delivery;
- bounded stream/backpressure behavior;
- device frame transport and other specialized routes.

`serverLayers.ts` assembles the long-lived service graph used by the server runtime.

`orchestration/projection` owns domain projectors, replay registration, history pruning and attachment side effects. The projection pipeline Layer composes these handlers and owns transaction boundaries, phase cursors and replay batching. Attachment filesystem cleanup remains outside the committed SQLite projection transaction. Snapshot query controllers separate row queries, row decoding, model assembly, project lookup and thread detail. They retain shared SQLite transaction ownership, bounded reads, projection cursor fences and transcript validation after transaction commit.

`orchestration/providerCommands` handles session configuration, human responses, queued turns, task control, conversation edits, naming, turn dispatch, bootstrap and durable delivery. ThreadSessionSettings, QueuedDispatchState and ProviderDeliveryGate own session settings, dispatch reservations and delivery coordination in scoped Layers. ProviderProjectionAccess exposes projected thread operations. The reactor shares one public service graph and isolates its private state owners. Remaining controllers still receive explicit capabilities; context bootstrap state remain in the reactor.

`provider/claude/adapter` handles SDK message conversion, assistant text, task tracking, human interactions, turn completion, discovery and session lifecycle. ClaudeSessionRegistry, ClaudeProcessOwnership, ClaudeSessionAccess and ClaudeRuntimeEvents expose session, process, admission and event operations through scoped Layers. The adapter captures the SDK callback runtime once and stops sessions before its event queue closes. Remaining controllers use explicit capabilities and flow-specific context views; their factory wiring is still being replaced.

Provider-neutral session setup, routing, branching, turn dispatch and human interactions use tags in `provider/Services` and implementations in `provider/Layers`. Lifecycle generations, interruption fences, idle timers and tasks, binding writes and event fanout each have a private state owner. The ProviderService Layer shares its public facade within one scoped graph, isolates private owners between separately constructed instances, and coordinates teardown. Idle timers use the captured callback runtime; binding persistence precedes adapter shutdown and event subscriptions remain alive through terminal publication. `provider/sessionRuntime` contains behavior tests and their harness.

GitCore composes GitCommands, GitStatus, GitDiff, GitWorktrees, GitRefs and GitBranches Layers. Command execution and status caches stay with their owners; repository mutation admission stays in GitCore. GitManager delegates pull-request and workspace handoff operations to GitHandoff.

### Orchestration

The orchestration layer is provider-independent and durable.

`orchestration/projector.ts` updates the snapshot sequence and routes each event to a focused handler in `eventProjections`. Shared immutable state updates, activity insertion, message retention and turn settlement preserve their existing ordering and bounds.

`orchestration/runtimeActivities` projects provider events into thread activities. Payload bounding and JSON safety, context-window calculations and tool approval presentation have separate modules; the projection preserves ordering, deduplication identities and credential redaction.

A typical state-changing request follows this shape:

```text
client request
    ↓
OrchestrationEngine command
    ↓
durable event / projection update
    ↓
ProviderCommandReactor (when provider work is required)
    ↓
ProviderService
    ↓
ProviderAdapter
```

Provider output travels back in the opposite direction:

```text
provider-native event
    ↓
ProviderAdapter canonical ProviderRuntimeEvent
    ↓
ProviderRuntimeIngestion
    ↓
orchestration command/event
    ↓
projection stream
    ↓
web client
```

Key files:

- `orchestration/Layers/OrchestrationEngine.ts` — command admission, durable event processing, read-model lifecycle;
- `orchestration/Layers/ProviderCommandReactor.ts` — turns durable provider intents into adapter operations;
- `orchestration/Layers/ProviderRuntimeIngestion.ts` — converts canonical runtime events back into durable orchestration state;
- `orchestration/Services/ProjectionSnapshotQuery.ts` — authoritative projection reads used by RPC/subscription recovery.

## Provider layer

`ProviderService` is the session-aware routing layer. It resolves the thread/provider relationship and delegates native work through `ProviderAdapterRegistry`.

Each concrete adapter implements the shared contract in `provider/Services/ProviderAdapter.ts` and translates one provider's native protocol into canonical runtime events. `ProviderAdapterRegistryLive` is the source of truth for the currently registered first-class provider set; [provider-architecture.md](./provider-architecture.md) documents the provider boundary and integration patterns but should not be treated as a stronger inventory authority than the registry itself.

Provider-specific session ids, process lifecycle, wire formats, model discovery, approvals, tools, and resume details should stay inside the provider layer whenever possible. Orchestration should depend on capabilities and canonical events rather than provider names.

## Persistence and local resources

Glade's server owns the local durable state and resource lifecycles:

- SQLite persistence and projections under `apps/server/src/persistence`;
- managed Git/worktree operations under `apps/server/src/git` and checkpointing/orchestration services;
- terminal processes under `apps/server/src/terminal`;
- attachments and workspace files through server-owned filesystem services;
- provider processes/sessions through adapter scopes and provider runtime services.

This ownership is why the web client can reload or reconnect without becoming the source of truth for an active turn.

## Desktop shell

`apps/desktop` is a native host, not a second orchestration implementation. It supervises a desktop-scoped Glade backend, loads the shared web UI, and provides OS/Electron integrations such as window lifecycle, native menus/shortcuts, updates, and platform-specific bridges.

Browser/web mode and desktop mode therefore share the same server contracts and most UI code.

## Connection and recovery model

The feature socket is negotiated before use and server restarts are fenced by server-instance/protocol compatibility. See [transport.md](./transport.md) for the detailed handshake.

For orchestration state, the client uses two principal subscription shapes:

- a lightweight shell stream for projects/thread summaries and application-level navigation state;
- scoped thread-detail streams for full conversation/activity state.

Streams support snapshot/replay recovery and client-side sequence fences. A late query or replay must not roll the client behind a newer live sequence; when recovery cannot be proven safe, Glade prefers a fresh snapshot.

## Design rules

When adding a feature, keep these ownership rules explicit:

1. durable domain truth belongs to server orchestration/persistence, not React state; client-owned drafts/layout remain explicitly local;
2. provider-native behavior belongs behind `ProviderAdapter` unless it is genuinely cross-provider orchestration;
3. state-changing side effects should have one authoritative server path and idempotent/replay-safe semantics;
4. client subscriptions may cache/project state but must respect server sequence/version fences;
5. resource lifecycles (processes, worktrees, sessions, streams) need deterministic cleanup and bounded queues/timeouts;
6. shared contracts belong in `packages/contracts`; cross-runtime utilities belong in `packages/shared`.

## Related documentation

- [provider-architecture.md](./provider-architecture.md) — provider adapter boundary and integration flow
- [transport.md](./transport.md) — WebSocket negotiation, compression, subscriptions, and resume
- [runtime-modes.md](./runtime-modes.md) — permission/runtime modes
- [workspace-layout.md](./workspace-layout.md) — repository package layout
- [ci.yml](../.github/workflows/ci.yml) — pull-request quality gates
