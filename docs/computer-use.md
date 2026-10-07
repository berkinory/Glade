# Computer Use

Computer Use lets an agent read and operate desktop apps the user has granted, through the
upstream [Cua Driver](https://github.com/trycua/cua) embedded in the desktop app. It exists only in
the desktop app, is off per chat by default, and is exposed to every provider as `computer_*`
gateway tools.

## Architecture

The pieces, from the OS outward: the desktop owns the driver process, the server owns the MCP
connection and every policy decision, and providers only see gateway tools.

- **Desktop host.** The Electron main process owns the driver, because macOS attributes
  Accessibility and Screen Recording grants to the process that starts it. `cuaBinary.ts` resolves
  `resources/cua-driver/<artifact>/cua-driver` and checks it against
  `apps/desktop/src/computer/cuaRelease.json` before anything executes it. Packaged macOS builds
  re-sign the executable, so there it must carry a valid signature from the same team as the app;
  every other build compares the upstream SHA-256. `cuaHost.ts` starts the
  `@trycua/cua-driver` embedded host once the platform's grants are present, restarts it with
  1–30 s backoff after an unexpected exit, stops it when a grant is revoked, and stops it on quit.
  Daemon telemetry is turned off.
- **Host RPC.** After every change, and whenever a backend authenticates, the desktop publishes
  `computer.connection` over the desktop host RPC (see [Browser Use](browser-use.md#desktop-host-rpc)):
  either `ready` with the driver generation and the MCP proxy's `command`, `args` and environment,
  or `unavailable` with a reason (`unsupported_platform`, `binary_missing`, `binary_mismatch`,
  `permissions_required`, `starting`, `failed`). The server can also ask the desktop to re-encode a
  screenshot as JPEG (`computer.encodeJpeg`), since the server has no image codec.
- **Server.** `ComputerHost` launches exactly the published stdio MCP proxy for each generation
  and is an MCP client to it; no Glade code speaks Cua's socket protocol. It runs
  `check_permissions` and `health_report` on connect, relaunches a dead proxy and reports status.
  Each thread gets its own Cua session. `ComputerAccess` owns grants and the access cards;
  `computerTask.ts` owns in-flight calls and the per-turn image budget.
- **Gateway.** The `computer_*` tools are listed only while the chat's Computer Use mode is not
  off. Providers read the tool list once per session, so changing the mode restarts the provider
  session with its resume cursor (at once when idle, otherwise at the next turn start).

## Turning it on and granting access

- `/computer` in the composer turns it on for the next message (`once`), including in a new chat.
  The chat's context menu turns it on or off for the conversation. There is no default for new
  chats.
- `computer_request_access` asks in the chat with a question card: allow read, act, full control,
  or deny, for one app or window. `read` covers window state, screenshots and zoom; `act` covers
  input; `full` adds foreground delivery and drags. Grants live in server memory for that chat,
  are listed in Settings > Computer Use with Revoke, and are gone after a restart.
- Calls outside a grant return typed errors the model can read (`computer_use_off`,
  `window_not_found`, `access_required`, `unknown_element`, `stopped`, or Cua's own code).
- Stop (or the turn interrupt) cancels in-flight Cua calls, refuses the rest of that turn and ends
  the chat's Cua session, which releases held input.

## Tools

Structured (preferred): `computer_apps`, `computer_window_state` (accessibility tree, screenshot
only on request), `computer_act` (click, type, keys, scroll, set value, menu by element index, with
background or foreground delivery), `computer_request_access`, `computer_stop`.

Pixel (fallback, window-scoped): `computer_screenshot`, `computer_zoom`, `computer_left_click`,
`computer_right_click`, `computer_double_click`, `computer_triple_click`,
`computer_left_click_drag`, `computer_scroll`, `computer_type`, `computer_key`, `computer_wait`.
Screenshots are capped at 1280 px on the longest edge and re-encoded as JPEG at that size;
coordinates are in that screenshot's space. A turn returns at most 20 images. Whole-screen actions
are not exposed, so every call names an app window a grant can cover.

## Platforms

Computer Use runs wherever the pinned Cua release has a build: macOS (one universal executable),
Windows x64 and arm64, Linux x64 and arm64. There is no Glade-side platform gate beyond driver
availability; Settings states each platform's limits.

| Platform | Permissions                                   | Delivery                                                                            |
| -------- | --------------------------------------------- | ----------------------------------------------------------------------------------- |
| macOS    | Accessibility and Screen Recording, for Glade | Background for most apps; foreground when Cua escalates (drags, some Chromium apps) |
| Windows  | None                                          | Actions that need the real pointer or keyboard bring the window to the front        |
| Linux    | None                                          | X11 accepts background input; Wayland supports accessibility-tree actions only      |

Only macOS has been verified end to end. Windows and Linux are open release checks.

## macOS permissions

Settings > Computer Use shows both grants, with Request (Accessibility prompt) and Open System
Settings. Current macOS shows no Screen Recording prompt, so the user adds Glade in the Screen
Recording pane. Permissions are polled every 3 s and re-read when the window regains focus.

Grants belong to the signing identity of the process that launches the driver. A Dev build started
from a terminal attributes them to the terminal, so verify Computer Use in the Dev app launched
through LaunchServices (`open` on the Dev bundle). The Dev launcher clears these grants whenever
it re-signs the bundle. Release grants must be checked with the signed, packaged app.

## Upgrading the driver

See [dependency maintenance](dependencies.md#cua-driver).

## Verifying

1. `bun run build:desktop` (fetches and verifies the driver) and `bun run check`.
2. Contract and trust tests: `apps/server/src/computer/cuaResults.test.ts` decodes fixtures
   captured from the pinned release; `apps/server/src/agentGateway/computer/computerAccessGate.test.ts`
   covers the grant gate.
3. Launch the Dev app through LaunchServices, grant both permissions, and confirm Settings shows the
   driver ready. Turn on `/computer` in a chat, grant TextEdit and ask the agent to type a sentence
   and read it back, then exercise a screenshot and zoom.
4. Kill the `cua-driver` process: Settings recovers with a new generation within a few seconds.
   Quitting Glade stops the daemon and the proxy.
