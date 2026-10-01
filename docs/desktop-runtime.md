# Desktop runtime

`apps/desktop/src/main.ts` starts the Electron host through
`main/createDesktopRuntime.ts`. The preload and standalone Cua host keep their
own entry points. Bundles still land in `dist-electron` with the same filenames;
source directory depth does not change runtime resource or preload paths.

## Ownership

- `main/window` owns window creation, appearance, native menus, notifications,
  application icons and permission handlers.
- `main/lifecycle` owns startup, logging, quit coordination, bundle replacement
  detection. Renderer crash handling lives with its window owner.
- `main/updates` owns updater configuration, check/download activity, pending
  artifacts, durable install handoff and recovery.
- `main/ipc` owns the channel catalogue, payload validation and handler registration.
  Browser and computer IPC remain with their respective domains.
- `main/protocol` owns static asset resolution and bundle identity checks.
- `backend` owns server readiness, supervision, process output and shutdown.
- `storage` owns profile state and persistent desktop preferences.
- `browser` owns tab state, panel attachment, guest adoption, popup hosting,
  runtime budgets and teardown. Its `automation`, `annotations` and `webMcp`
  subdirectories own their respective trust boundaries.
- `computer/cua` owns authenticated host transport, tool admission, native driver
  generations, task cursors, physical input interruption and target observation.
  Permission guides, the activation shield and frame tap live under `computer`.
- `windowsShell` owns taskbar artwork and AppUserModel integration.

## Instance state and startup

`createDesktopRuntime` connects the application domains and installs the Electron
lifecycle handlers. Backend process/readiness state, update activity/install state,
window/menu/notification state, protocol caches, storage recovery and computer host
resources each belong to their domain constructor. The composition sees operations,
not an application-wide mutable state object. Immutable identity, paths and timing
configuration come from `main/desktopEnvironment.ts`; IPC names come directly from
`main/ipc/ipcChannels.ts`.

The packaged bundle identity is captured before shell environment hydration. The
Electron user-data path and single-instance lock are established before browser
services are constructed. Profile repair and privileged protocol registration run
before `app.whenReady()`. Constructors must not call dependencies while composition
is still being assembled; callbacks become usable after all domains are connected.

Browser and Cua owners retain internal runtime composition while their maps,
transport resources, admission state and cancellation fences are progressively
encapsulated. Some of these factories still have broad operation dependencies; the
strict eight-field input target and pre-composition source-size target remain open.

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

## Notification permissions

The Notifications settings page reads OS authorization separately from the user's
alert preference and refreshes it when the window regains focus. macOS uses a
small Node-API module in the Electron process to query and request UserNotifications
authorization for Glade's own bundle. Source launchers and desktop builds compile
it with Xcode command-line tools and the `node-api-headers` development dependency;
packaging rebuilds it for the target architecture and unpacks the module from ASAR.

Windows reads the app's WinRT toast notification setting and links to notification
settings when changes are needed. Linux has no portable authorization query;
Glade reports that limitation separately from unsupported notifications. Browser
clients use the browser permission API and direct blocked users to site settings.
