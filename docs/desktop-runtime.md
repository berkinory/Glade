# Desktop runtime

`apps/desktop/src/main.ts` starts the Electron host through
`main/createDesktopRuntime.ts`. The preload and standalone Cua host keep their
own entry points. Bundles still land in `dist-electron` with the same filenames;
source directory depth does not change runtime resource or preload paths.

## Ownership

- `main/window` owns window creation, appearance, native menus, notifications,
  application icons and permission handlers.
- `main/lifecycle` owns startup, logging, quit coordination, bundle replacement
  detection and renderer crash recovery.
- `main/updates` owns updater configuration, check/download activity, pending
  artifacts, durable install handoff and recovery.
- `main/ipc` owns the channel catalogue, payload validation and handler registration.
  Browser and computer IPC remain with their respective domains.
- `main/protocol` owns static asset resolution and bundle identity checks.
- `backend` owns server readiness, supervision, process output and shutdown.
- `storage` owns profile state, migration recovery and consent handoff.
- `browser` owns tab state, panel attachment, guest adoption, popup hosting,
  runtime budgets and teardown. Its `automation`, `annotations` and `webMcp`
  subdirectories own their respective trust boundaries.
- `computer/cua` owns authenticated host transport, tool admission, native driver
  generations, task cursors, physical input interruption and target observation.
  Permission guides, the activation shield and frame tap live under `computer`.
- `windowsShell` owns taskbar artwork and AppUserModel integration.

## Instance state and startup

The application runtime owns mutable window, backend, browser and updater state.
Domain factories receive typed subsets of that runtime and publish their callable
operations. Functions used only within a domain keep direct local calls. The
composition installs operations before `initializeDesktopState` evaluates startup
state, preserving the original function-hoisting and initialization order.
Only after initialization does `registerDesktopLifecycle` attach the application
ready/quit, foreground and process-error handlers.

`DesktopBrowserManager`, `DesktopBrowserAutomationHost` and `CuaDriverHost` remain
small public facades. Each constructs its own runtime; maps, queues, ownership
fences and cancellation state belong to that instance. Their domain factories
capture the instance instead of relying on module-level mutable singletons.
Factories must not execute operations during assembly: fields and owned resources
are initialized before callbacks are allowed to use them.

IPC channel values, preload methods, environment variables, stored paths and data
formats are unchanged. Moving a source file does not authorize changing one of
those contracts.

## Verification

Run the existing desktop tests with `bun run --cwd apps/desktop test`. Browser
ownership, popup, presentation and human-control cases live beside their runtime
modules; Cua transport, retirement, Escape, task ownership, Linux capability and
shield cases live under `computer/cua`. Shared test fixtures preserve the same
assertions and resource cleanup. The browser mock fixture must load before browser
runtime imports so Electron is mocked at that boundary.

`bun run build:desktop` builds the host and backend/web bundle. The existing
`bun run --cwd apps/desktop smoke-test` uses the source desktop launcher and an
isolated home/profile. It verifies startup and backend readiness without starting
provider turns or native input. Run `bun scripts/check-windows-runtime-boundary.ts`
after process/platform boundary changes.

Local startup and tests do not verify signed update installation or Windows shell
behavior on a different operating system. Those still require the release and
platform checks described in [the release guide](release.md).
