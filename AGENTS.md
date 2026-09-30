# Glade agent guide

Glade is an independently maintained desktop app for working with coding agents: a Bun/Turbo monorepo with an Effect server (`apps/server`), a React client (`apps/web`), an Electron host (`apps/desktop`), and shared packages (`packages/contracts`, `packages/shared`).

A coherent codebase and complete product behavior matter more than easy upstream rebases.

## Where to look

- [docs/README.md](docs/README.md) is the documentation index.
- [docs/workspace-layout.md](docs/workspace-layout.md) covers repository structure and ownership.
- [docs/architecture.md](docs/architecture.md), [docs/transport.md](docs/transport.md), [docs/provider-architecture.md](docs/provider-architecture.md) and [docs/desktop-runtime.md](docs/desktop-runtime.md) cover runtime boundaries.
- [docs/glade-feature-scope.md](docs/glade-feature-scope.md) defines what the product does and does not include.
- [CONTRIBUTING.md](CONTRIBUTING.md) lists the checks and how to run Glade locally. [docs/release.md](docs/release.md) covers releases. [docs/windows-runtime.md](docs/windows-runtime.md) covers platform and process boundaries. [docs/dependencies.md](docs/dependencies.md) covers overrides and patches.
- Plan files at the repository root (such as `PLAN.md`) describe in-flight work. Follow them when assigned. They do not override this file.

## Code design

- **Ownership:**
  - Durable truth and side effects live in `apps/server`.
  - Presentation lives in `apps/web`.
  - Native and Electron work lives in `apps/desktop`.
  - Cross-process shapes live in `packages/contracts`.
  - `packages/shared` holds only code used by at least two apps.
  - Dependencies point one way: contracts, then shared, then apps. Apps never import each other. No import cycles and no barrel files.
- **Small surfaces:**
  - A module does one thing and exports only what other modules use.
  - A function, hook, component or factory takes at most about eight independent inputs.
  - Never type a parameter as another module's `ReturnType<typeof makeX>` or `ReturnType<typeof useX>`. Depend on an Effect service or a small interface named for the capability.
- **State ownership:**
  - Every piece of mutable state has one owner that exposes operations. Never pass raw `Map`s, `Set`s, `Ref`s or arrays between modules.
  - Do not create app-wide runtime objects, controller bags or context god-interfaces that every module reads.
  - On the web, server data lives in one place (the orchestration store or TanStack Query) and is not copied into other stores.
- **Size:**
  - Files, tests included, stay under ~1000 lines.
  - Split along responsibilities, not line counts.
  - When a module grows beyond three parts it becomes a folder, not a flat `x.a.ts`, `x.b.ts` family.
- **Less code:**
  - Reuse before you build. Search for an existing component, hook, store, schema or helper, and extend it with a prop or variant when it almost fits.
  - When a second surface needs the same shape, extract the shared piece and move both to it.
  - Shrink before you split. Refactors should be net-negative in lines; if one is not, justify it in the commit.
  - Do not add speculative abstractions, pass-through wrappers, compatibility layers for hypothetical callers, or success-shaped fallbacks that hide failure.
- **Effect:**
  - Split large services into services or pure modules with explicit dependencies, not hand-wired closure factories.
  - No `Effect.runPromise` or `Effect.runFork` inside services. Bridge SDK callbacks through a runtime captured once at the boundary.
  - Use tagged errors, no `try/catch` inside generators, and resources scoped with `Scope`.
  - Keep the `Services/` (tag) and `Layers/` (implementation) layout.
- **Boundaries:** use shared contracts for cross-process schemas, and the shared process/platform modules for executable resolution and teardown. Preserve trust boundaries, session ownership, cancellation and deliberate error handling.
- **Naming:**
  - React components and Effect service/layer modules use PascalCase; everything else uses camelCase. Pure logic sits next to its component as `X.logic.ts`.
  - Do not use `utils`, `helpers`, `misc` or similar catch-all names.
  - Each concept has exactly one name; do not add alias exports.
- **Lint and types:**
  - Lint runs with zero warnings.
  - Do not disable a rule to get a change through. Fix the code.
  - An inline suppression or `as unknown as` needs a real boundary and a one-line reason.
- **Comments:**
  - Comments explain only what the code cannot: an invariant, an ordering or race constraint, a trust or security reason, a platform quirk, an upstream bug.
  - No file headers, export lists, narration, history, or commented-out code.
  - Write them in plain English for engineers.

## Web UI

- **Typography:** text follows the user's font size setting. Use the `text-ui` tokens from the `@theme` block in [index.css](apps/web/src/index.css) (driven by [useAppTypography.ts](apps/web/src/hooks/useAppTypography.ts)):
  - `text-ui` for body text;
  - `text-ui-sm` and `text-ui-xs` for secondary text;
  - `text-ui-lg` for emphasis and small titles;
  - `text-chat*` for transcript content.

  Never use fixed Tailwind sizes (`text-sm`, `text-[11px]`). Only dialog titles and large headings may use a fixed size.

- **Motion:** open/close motion reuses [disclosureMotion.ts](apps/web/src/lib/disclosureMotion.ts) and its disclosure components, including reduced motion.
- **Transcript:** auto-follow tracks real assistant text streaming, not tool rows, buffering, reconnects or pending approvals. Keep the transcript path simple, add virtualization only for a measured need, and never couple virtualizer measurement to bottom-stick behavior.
- **Memoization:** React Compiler compiles the client. Do not add `useMemo`, `useCallback` or `memo()` unless the value's identity leaves React (store selectors, external subscriptions) or a measured cost requires it.

## Persistence and user data

- **Migrations:**
  - The first public release starts with a single schema baseline at migration 112. The ID preserves existing internal databases without rewriting their migration history. Future schema changes use migrations starting at 113, appended in order; never edit, rename or renumber a released baseline or migration.
  - A new migration must be idempotent and must not delete user data silently.
- **Legacy data:** compatibility readers exist only while real stored data still needs them. Measure before removing one, and never keep a retired feature alive through a migration path.
- **The user's database:** never reset, rewrite or "repair" it to make something pass. Test against copies in an isolated home directory.

## Tests

Tests exist to catch regressions that would really hurt. Fewer, stronger tests are better than broad shallow coverage.

**Before adding or changing a test, answer:**

1. What observable behavior or contract does it protect?
2. What credible regression makes it fail?
3. Why doesn't existing coverage catch it? Each contract has one owning test at its strongest boundary.
4. Does it need a production seam (an export, flag or hook) that only tests use? If so, test at the real boundary instead.

**Keep tests for:**

- access control and trust boundaries;
- persisted data and migrations;
- provider, process and session lifecycles;
- protocol and contract shape;
- release integrity;
- essential end-to-end flows.

**Do not write, and remove when found:**

- tautological tests: expected values computed by the code under test, mocks that implement the asserted behavior, self-comparisons;
- trivial tests of simple code;
- source-text, import, snapshot or copied-inventory assertions;
- tests proving a removed feature is gone;
- tests for features that no longer exist;
- duplicates of the same contract at another layer;
- tests that exist only to keep test-only exports alive (delete the export too).

**Browser and UI tests:** only for critical flows. Verify presentation changes in the running app; the dedicated browser test harness is retired and is not rebuilt without a concrete, critical gap.

**Writing tests:**

- Tests read like good code: clear names, table-driven cases instead of near-copies, shared fixtures instead of repeated setup, and no comments unless essential.
- Split slow suites along behavior lines; do not drop what they prove to make them faster.
- A bug regression test must fail before the fix.

**Running tests:** use `bun run test`, never `bun test`, which picks a different runner. Do not edit files while Vitest is running.

## Verification

- **While iterating:** run the smallest relevant checks.
- **Code changes:** finish with `bun run check` plus the affected tests. Cross-package or lifecycle changes need the full `bun run test`.
- **Formatting:** `bun run check:fix` applies formatting and safe lint fixes; review its diff.
- **Targeted checks:**
  - `bun scripts/check-windows-runtime-boundary.ts` for platform or process changes;
  - `bun scripts/check-migration-lineage.ts` for migration changes;
  - `bun run build:desktop` for packaging, desktop or export-map changes.
- **Runtime verification:** check UI and runtime behavior in the running Dev app. Use the real launcher for desktop and icon checks, never bare Electron.
- **Isolated instances:** when another Glade instance is running, use a separate home directory and unused ports; check the dev runner's dry-run output first. An inherited `GLADE_AUTH_TOKEN` must match the client; remove it only from the isolated process. Check both IPv4 and IPv6 listeners.
- **Hydration leads:** an empty UI with a healthy `orchestration.getSnapshot` is a hydration or connection lead, not a reason to touch SQLite.
- **Prose-only changes:** check links, commands and consistency; they do not need a rebuild.
- **Report honestly:** say what ran, what failed, and what was not verified. A mock is not a live provider, and a local build is not a signed release.

## Finishing a change

- **Consistency:** update code, active docs and examples together. Search for leftovers of anything you renamed or removed and inspect each hit.
- **Commits** (when authorized):
  - Use a conventional subject such as `refactor(web): …` or `fix: …`.
  - The body states the behavior change, the net line delta for refactors, and the checks run.
- **Changelog:** [CHANGELOG.md](CHANGELOG.md) is for users. Add entries under the unreleased version with the categories New, Improved, Fixed and Removed.
  - One short line per user-visible change, in general terms. No internal identifiers, file names, line counts or code-level numbers.
  - Merge related entries; do not repeat a change across lines.
  - Skip small fixes, internal refactors, tests and tooling unless they change how people use or build Glade.

## Removed features

- Kanban is retired; do not reintroduce its board, routes or task composer.
- The device simulator and its agent controls are retired. Computer Use remains supported.
- Thread goals are retired; do not adopt native provider goals or reintroduce automatic goal continuation.
- Plan mode and proposed plans are retired; do not adopt native provider plan modes.
- Debug mode and interaction modes are retired; provider runtime permission modes remain supported.
