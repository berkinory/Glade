# Workspace layout

Glade is a Bun/Turbo monorepo. Runtime ownership is split across the app workspaces, while shared schemas and cross-runtime helpers live under `packages`.

- `/apps/server` — The authoritative Glade backend and private `@glade/cli` package. Owns orchestration/persistence, provider adapters and health/discovery, Git/worktrees, terminals, automation, workspace files, HTTP/WebSocket RPC, and the bundled web client used outside Vite development.
- `/apps/web` — React + Vite application. Owns presentation, client transport/state coordination, chat/composer/editor/dock surfaces, and subscription-driven projection of server-authoritative state.
- `/apps/desktop` — Electron host for the shared web client. Supervises a desktop-scoped Glade server process and provides native window, update, IPC, browser-automation, and other OS/Electron integrations.
- `/packages/contracts` — Shared Effect Schema and TypeScript contracts for orchestration, provider/session/model data, RPC methods, settings, keybindings, automation, device/browser surfaces, and other cross-process payloads. Imports use domain subpaths such as `@glade/contracts/core/baseSchemas` and `@glade/contracts/transport/ws/rpc`; RPC registrations live in domain modules such as `transport/ws/terminalRpc`, while `transport/ws/rpc` composes the feature group. There is no root barrel.
- `/packages/shared` — Runtime modules consumed by at least two applications, grouped into platform, transport, threads, computer, browser, git, HTTP, text, provider and workspace domains. Server-only workers, stream decoders, filesystem durability and settings merge code live in the server. Uses explicit subpath exports (for example `@glade/shared/git/git` and `@glade/shared/threads/threadWorkspace`) rather than one catch-all barrel.
- `/scripts` — Repository-level development, packaging, release, migration-lineage and smoke-test tooling. Package-specific scripts remain with their owning app when they depend on that workspace's package context or Turbo task ownership.

## Ownership rule of thumb

- Durable application truth and server-authoritative/backend side effects belong in `apps/server`.
- Server source root contains `index.ts`, `main.ts` and `serverLayers.ts` for CLI entry and composition. HTTP, WebSocket, lifecycle, runtime and status modules live under `server`; provider-specific modules live under `provider/codex` and `provider/claude`, with shared provider policy under `provider/core` and usage collection under `provider/usage`. Attachments, voice, settings, diagnostics, workspace editors and filesystem boundaries own their source and adjacent tests.
- Browser presentation belongs in `apps/web`; desktop-only native hosting and Electron/OS side effects belong in `apps/desktop`.
- Desktop source root contains only `main.ts`, `preload.ts` and `cuaDriverHostStandalone.ts` entry points. Window, lifecycle, update, protocol and IPC composition live under `main`; browser hosting lives under `browser`, native computer input under `computer/cua`, backend supervision under `backend`, and durable profile/recovery state under `storage`. See [desktop runtime](desktop-runtime.md) for instance ownership and startup ordering.
- Cross-process data shapes belong in `packages/contracts`.
- Runtime utilities genuinely shared across multiple workspaces belong in `packages/shared`, whether pure or stateful/I/O-bound when the cross-runtime abstraction is intentional.
- Repository-level build/release/developer automation belongs in `/scripts`; app-specific automation stays in the owning workspace when it relies on local dependencies or package tasks.

See [architecture.md](./architecture.md) for the runtime/data-flow overview and [provider-architecture.md](./provider-architecture.md) for provider integration boundaries.

## Boundary validation

`packages/shared/src/transport/payloadValues.ts` owns unknown-object guards and conversions
used at provider, RPC, browser annotation and UI payload boundaries. `isRecord` and
`asRecord` reject arrays; `isObjectRecord` and `asObjectRecord` preserve the object
semantics required by existing payload readers, including arrays. Callers retain their
`null`, `undefined`, `Option` or empty-object absence policy. This small module is a
shared validation boundary with its own contract.

Historical migration validators stay with their released migration. Changing those
validators would change the interpretation of persisted data during migration.
Generic error-to-string conversion lives in `text/errorMessages`; automation redaction
and router/device fallback messages remain domain policies rather than a generic
formatter with switches.

Scalar boundary readers preserve distinct policies: `text/text` owns raw, non-empty,
non-blank and normalized string values; `transport/payloadValues` owns arrays and
finite, positive or numeric-string values. Callers retain their absence values.
Argument readers that name a field and raise domain errors keep that validation
policy with the owning API. A typed provider-string normalizer retains its strict
input contract rather than accepting arbitrary payload values.

Server subprocess execution belongs to `platform/processRunner`: its callback bridge uses
the shared executable planner while preserving Node output and error properties;
its shell-command entry owns platform shell selection. Provider usage and worktree
setup call those boundaries rather than selecting Windows launch policy themselves.
