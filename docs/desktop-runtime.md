# Desktop runtime

`apps/desktop/src/main.ts` starts the Electron host through
`main/createDesktopRuntime.ts`. The preload keeps its own entry point. Bundles still land in `dist-electron` with the same filenames;
source directory depth does not change runtime resource or preload paths.

## Ownership

- `main/window` owns window creation, appearance, native menus, notifications,
  application icons and permission handlers.
- `main/lifecycle` owns startup, logging, quit coordination, bundle replacement
  detection. Renderer crash handling lives with its window owner.
- `main/updates` owns updater configuration, check/download activity, pending
  artifacts, durable install handoff and recovery.
- `main/ipc` owns the channel catalogue, payload validation and handler registration.
- `main/protocol` owns static asset resolution and bundle identity checks.
- `backend` owns server readiness, supervision, process output and shutdown.
- `storage` owns profile state and persistent desktop preferences.
- `windowsShell` owns taskbar artwork and AppUserModel integration.

## Instance state and startup

`createDesktopRuntime` connects the application domains and installs the Electron
lifecycle handlers. Backend process/readiness state, update activity/install state,
window/menu/notification state, protocol caches and storage recovery each belong to their domain constructor. The composition sees operations,
not an application-wide mutable state object. Immutable identity, paths and timing
configuration come from `main/desktopEnvironment.ts`; IPC names come directly from
`main/ipc/ipcChannels.ts`.

The packaged bundle identity is captured before shell environment hydration. The
Electron user-data path and single-instance lock are established before application
services are constructed. Profile repair and privileged protocol registration run
before `app.whenReady()`. Constructors must not call dependencies while composition
is still being assembled; callbacks become usable after all domains are connected.

IPC channel values, preload methods, environment variables, stored paths and data
formats are unchanged. Moving a source file does not authorize changing one of
those contracts.

## Startup locks and quitting

The server publishes its database lifecycle lock atomically. Startup recovers an
ownerless lock or stale-lock recovery guard only when it is empty or holds nothing
but Finder's `.DS_Store`; live owners, invalid owner metadata, links and unknown
files stay in place, and a populated lock is never removed recursively. When the
backend reports a lock it cannot verify, the desktop dialog does not claim that
another server owns it: it names the backend log file and offers **Open logs**
next to **Try again** and **Quit**.

User-initiated quits ask the renderer for running chats. When the renderer is
missing, crashed, unanswering or not yet hydrated, the host shows a native quit
confirmation instead of treating that as an empty list. One decision is in flight
at a time and repeated quit requests wait for it; cancelling, or failing to show
the dialog, keeps the app open. A renderer that crashes during the ask moves it to
the native confirmation, and crash recovery runs only if the user stays.

## Agent hosts

The desktop hosts native surfaces for agents and nothing else; policy and state live in the server.
`hostRpc/startDesktopHost.ts` starts the desktop host RPC server and passes its path and token to
the backend. `browser` owns the agent browser's tabs, CDP sessions and panel placement, and
`computer` owns the embedded Cua Driver and the macOS Accessibility and Screen Recording probes
(renderer IPC `desktop:computer-permissions-get`, `-request` and `-open-settings`). Desktop shutdown
stops the driver after the backend has exited. See [Browser Use](browser-use.md) and
[Computer Use](computer-use.md).

## Verification

Run the existing desktop tests with `bun run --cwd apps/desktop test`. Tests live
beside their runtime modules.

`bun run build:desktop` builds the host and backend/web bundle. The existing
`bun run --cwd apps/desktop smoke-test` uses the source desktop launcher and an
isolated home/profile. It verifies startup and backend readiness without starting
provider turns. Run `bun scripts/check-windows-runtime-boundary.ts`
after process/platform boundary changes.

Local startup and tests do not verify signed update installation or Windows shell
behavior on a different operating system. Those still require the release and
platform checks described in [the release guide](release.md).

## Notification permissions

Activity sounds are enabled by default and controlled by one toggle in Notifications
settings, independently of in-app toasts and desktop banners. The renderer plays
distinct original cues for settled successful work and new approval or reply requests,
including in the foreground. Hydration does not replay old chat alerts. Input requests
take priority over completion cues, and overlapping cues are coalesced. Desktop and
browser banners are silent so the sound toggle also prevents a duplicate system sound.

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

## Native header hit regions

The existing 46 px header uses `drag-region` for unused space, including title text and gaps between controls. Apply `no-drag` to interactive targets rather than their layout containers. Native inputs, links, buttons, supported interactive roles, editable content and draggable tabs are excluded by shared CSS. Portalled dialog/menu/popover/select/combobox/tooltip surfaces also exclude dragging. Keep resize handles interactive and retain caption controls after drag regions in document order.

Chat renaming uses the explicit Rename chat pencil button. Title double-click is reserved for the operating system's title-bar preference. Glade does not implement custom movement or a maximize handler; Electron/native hit testing owns drag, snap, zoom and supported window-menu behavior. Browser clients keep ordinary pointer behavior.

Verify through the real Dev launcher, using an isolated home when another instance is running. Check blank areas at the top, middle and bottom of chat/sidebar/dock/settings headers, controls and gaps, menus/dialogs, rename and resize handles. Repeat with docks open/closed, narrow windows, larger text, zoom, fullscreen and maximized state. On Windows/Linux check caption buttons, native menu and supported snap; on macOS check traffic lights and the configured double-click action. DOM screenshots do not establish native hit testing.

The macOS Dev verification exercised settings navigation and native double-click zoom from 1100×780 to 1710×1072. Coordinate dragging was blocked by the native automation tool with `windowNotFoundAtPosition`; movement is not claimed verified. Rename, Windows/Linux native input, snap/window menus, multiple-display scaling and the complete layout matrix remain unverified.

## Window material

Appearance settings can enable a native backdrop for the whole main window, off
by default. macOS uses under-window vibrancy; Windows uses Mica on Windows 11
22H2 (build 22621) or newer. Mica is a wallpaper-based material, not live blur of
windows behind Glade. Unsupported systems keep the normal opaque window.

The desktop host persists the preference in `desktop-window-material.json` in
its state directory and applies it at creation and through validated IPC without
restarting. The renderer opens only the layout surfaces over one theme tint;
text, images, editors and web pages retain their own rendering. Floating menus
and the composer stay opaque in this mode, without additional CSS backdrop blur.
The BrowserWindow does not use `transparent: true` or window-wide opacity.
On macOS, this mode disables the native outer window shadow to avoid retained
hover-overlay shapes; switching the material off restores the shadow. Terminal
panes keep an opaque renderer and use one theme-derived elevated background
across their canvas and padding, avoiding a separate dark rectangle.

Native materials belong to the OS compositor. Renderer-only captures do not
include the native backdrop; capture the native window or screen to verify the
composited appearance.

## Window actions and launcher output

Custom title-bar actions report rejected native calls through error notifications. Repeated
clicks share the pending action; disposed controls discard late results and errors. Native
state events own maximize/restore presentation, and a late initial read cannot replace a
newer event.

The logging owner handles stdout/stderr EPIPE at the stream boundary. Losing a launcher
output sink leaves the GUI running and packaged file logging active, without writing an
error back to that pipe. Other stream errors retain the fatal path. On POSIX, SIGINT and SIGTERM
request graceful shutdown without the running-chats prompt and are bounded at 5 s, even when an
earlier quit is still waiting: past that the app exits, and the backend, which watches its stdin
for the desktop going away, finishes its own shutdown. Electron installs its own signal handlers while
starting, so the desktop installs its handlers again once the app is ready; a signal during
startup skips the remaining startup work and runs the same bounded shutdown.
