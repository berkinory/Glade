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
  screenshot as JPEG (`computer.encodeJpeg`), since the server has no image codec, and for the
  seconds since the user last used the mouse or keyboard (`computer.userIdle`, Electron's
  `powerMonitor.getSystemIdleTime()`, whole seconds; `null` on Linux, where Chromium cannot tell
  outside X11). The desktop sends `computer.killSwitch` when the kill switch shortcut is pressed.
- **Server.** `ComputerHost` launches exactly the published stdio MCP proxy for each generation
  and is an MCP client to it; no Glade code speaks Cua's socket protocol. It runs
  `check_permissions` and `health_report` on connect, relaunches a dead proxy and reports status.
  Each thread gets its own Cua session. `ComputerAccess` owns grants and the access cards;
  `computerTask.ts` owns in-flight calls and the per-turn image budget; `windowSnapshots.ts` owns
  each window's element indexes; `computerProgressGuard.ts` the repeat guard; `appCategories.ts`
  the browser and terminal/IDE lists.
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
  are listed in Settings > Computer Use with Revoke, and are gone after a restart. Only the owner
  session sees and revokes them; paired devices do not. An answer only settles a card of the chat
  it was given in.
- Access follows the chat's permission mode, read at each call, so switching the mode applies to
  the next call:
  - Full access: no cards. The first call that needs an app grants `full` for the whole app and
    goes ahead; the timeline shows one "Access granted" row noting the mode. Terminals and IDEs
    therefore take typing and keys too, as the user's shell tools already could; browsers stay
    read-only by category.
  - Approve for me (`auto`): reading and background input (`act`) are granted on first use without
    a card; `full` (foreground delivery, drags, anything that moves the real pointer or keyboard)
    asks once per app, and that answer stands for the chat.
  - Ask for approval: every grant comes from a card, as above.
  - A denial given in the chat wins over any mode. Lowering the mode keeps existing grants;
    Settings > Computer Use lists them, marking automatic ones as "auto (<mode>)", and revokes them.
- Every window-scoped call checks that the window belongs to the pid it names.
- App categories cap every grant without extra prompts. Apps are identified at action time by the
  bundle id of the process that owns the target window (macOS), or by executable name on Windows
  and Linux. Browsers are read-only: web work goes through Browser Use, so input and act or full
  requests are refused with a pointer to the `browser_*` tools. Terminals and IDEs (Glade included)
  take plain clicks and scrolling under `act`; typing, keys, right-clicks, modifier clicks, drags,
  `set_value` and menus need `full`.
- Calls outside a grant return typed errors the model can read (`computer_use_off`,
  `window_not_found`, `access_required`, `browser_read_only`, `click_only`, `unknown_element`,
  `no_progress`, `user_active`, `menu_item_not_found`, `access_denied`, `file_exists`, `app_not_found`,
  `unsupported_target`, `target_not_found`, `unsupported_platform`, `stopped`, or Cua's own
  code).
- Stop (or the turn interrupt) cancels in-flight Cua calls, refuses the rest of that turn and ends
  the chat's Cua session, which releases held input. Cua holds no keys or buttons between calls
  (drags are one call), so ending the session and cancelling the in-flight call is the release.
- Kill switch: Control+Option+Command+Escape on macOS, Control+Alt+Shift+Escape elsewhere, registered
  system-wide by the desktop while the driver is ready (no default Glade keybinding uses Escape with
  modifiers; macOS keeps Command+Option+Escape for Force Quit). It interrupts every turn that is
  still using the computer, exactly like Stop in each chat, and ends every Cua session at once.
- Foreground delivery (and drags, which are always foreground) yields to the user: when the mouse
  or keyboard was used within the last second it is refused with `user_active` and the agent
  retries later. Cua's foreground drags move the real pointer and reset the OS idle clock (its
  foreground keys do not), so after the agent's own foreground input the check first waits until
  a full idle second has passed. Background delivery is unaffected; on
  Linux the check is skipped because the idle time is unknown.

## Tools

Reading: `computer_apps` (Cua's `get_accessibility_tree`: running apps and their on-screen windows
front to back, fast and without permissions; `installed: true` adds apps that are not running from
`list_apps`), `computer_window_state` (accessibility tree, screenshot only on request),
`computer_screenshot` (with `region`, a zoomed close-up), `computer_verify` (Cua's `verify_state`:
waits up to 10 s for element conditions with stable samples). Input, one tool per action as in
Anthropic's `computer_toolset_20260801` and Codex/Cua: `computer_left_click`, `computer_right_click`,
`computer_double_click`, `computer_triple_click`, `computer_type`, `computer_key`,
`computer_select_text`, `computer_scroll`, `computer_set_value`, `computer_menu`,
`computer_left_click_drag`. Apps and panels:
`computer_open_app`, `computer_file_dialog` (a macOS Open or Save panel in one call; listed on
macOS only, and agents elsewhere set a dialog's name field to the full path),
`computer_window_frame` (Cua's `set_window_frame`: x, y, width, height in desktop points, then the
window is listed again and the result states the geometry it ended up with; needs `act`, and
browsers refuse it like other input). Clipboard: `computer_clipboard_write`,
`computer_clipboard_read`. Session:
`computer_request_access`, `computer_stop`.

Every window tool names its window by `pid` and `window_id` or by `app` (a name or bundle id, which
resolves to the app's frontmost window). Input tools address an `element_index` from the window's
tree (preferred) or a `coordinate` in the window's latest screenshot; type, key and scroll without
either go to the window's focus, and drags take `start_coordinate` and `coordinate`. `delivery` is
background unless foreground is asked. The grant, app category, repeat guard and user yield run in
one shared path for all of them. Triple clicks need a coordinate (Cua repeats clicks only on the
pixel path). `computer_key` reads xdotool and `+` syntax (`Return`, `super+c`, `cmd+shift+z`,
`ctrl++`) and runs space-separated keys in order (`Down Down Return`); `cmd` means Command on macOS
and Control elsewhere.

`computer_select_text` selects from the caret in a text element (`element_index` focuses it) or the
window's focused field: `all`, `line`, `word`, `to_start`, `to_end`, or `count` characters `left` or
`right`. It sends the selecting chords (Command-A; Command-Left then Command-Shift-Right; Option-Left
then Option-Shift-Right; Shift-arrows; Home, End and Control on Windows and Linux) with foreground
delivery, so it needs `full` and yields to the user like other foreground input. Cua 0.34 has no
selection-range tool and its trees do not expose the selected text. Cua's `type_text` inserts
through the accessibility API, so typed text never picks up a style toggled by a shortcut: the
guidance tells agents to select the text, then apply the format from the menu (Format ▸ Font ▸
Bold).

`computer_open_app` takes an app name or bundle id (resolved through Cua's `list_apps`, which also
lists installed apps that are not running) and optional `open` targets, and calls Cua's
`launch_app` in the background. An app that is already running is reused: the targets open in it.
Targets must be absolute paths that exist (or `file:` URLs) or http(s) URLs; every other scheme
(`x-apple…`, `javascript:`, `tel:`, custom handlers) is refused with `unsupported_target`, so a
launch never fires a URL handler. The call needs `act` on the app through the same grant gate as
every other tool. Browsers can be launched but never handed targets (`browser_read_only`, pointing
to the `browser_*` tools); terminals and IDEs launch normally and their later input still meets the
click-only tier. The result names the app, its pid and window count, then waits up to 5 s for a
window per target (titled with the file or folder name, or new for a URL) and says which window
each target opened in; window titles are listed inside `APP_CONTENT`. Opening targets is
macOS-only: Cua 0.34 on Windows and Linux hands `urls` to the system's default handler (the
default browser, `xdg-open`) instead of the named app, so there the call refuses `open` with
`unsupported_platform` and only launches.

Clipboard: `computer_clipboard_write` takes exactly one of `text`, `image_path` or `file_path`
(absolute, existing files) and reports the clipboard's types, never its contents. The clipboard
belongs to no app, so writing is allowed whenever Computer Use is on; pasting is input to an app and
meets that app's grant. Paste with `computer_menu` Edit > Paste, which works in the background;
`computer_key` cmd+v lands in the foreground on an `element_index`. `computer_clipboard_read`
returns plain text inside `APP_CONTENT` (`source=clipboard`) plus the types. Because the clipboard
can hold anything the user copied, reading is allowed without asking only in Full access; Approve
for me and Ask for approval show one card per chat ("Allow clipboard reading" or "Deny") and the
answer stands for the chat until the server restarts. A denial refuses with `access_denied`. Glade
never logs clipboard contents.

Menus: `computer_menu` takes the path as an array or one string with `>`, `▸` or `→`. Cua's
`invoke_menu` matches titles exactly except `...` for `…`, so Glade retries a segment Cua cannot
find with the ellipsis flipped, then against the titles the window's tree lists at that level
(ignoring case, a trailing ellipsis and `⌘` shortcut suffixes). When nothing matches it refuses
with `menu_item_not_found` and the available titles in `details.available`. Closed menus can omit
items an app adds only while the menu is open (TextEdit's File ▸ Save…).

Sheets: a Save panel or alert attached to a window is an `AXSheet` in that window's tree, and Cua
0.34 acts on its controls by element through the window. A full-depth walk of a Save panel spends
Cua's 1 s budget in the column browser and is cut before the panel's buttons, so a cut read that
shows a sheet is repeated at depth 5, where every panel control sits. Window reads name open sheets
first, and action results say `Sheet opened` or `Sheet closed`.

`computer_file_dialog` takes the document window (or an app's standalone Open window), `action`
`save` or `open`, an absolute `path` (the folder to save into, or the file to open) and an optional
`file_name`. It opens the panel through File ▸ Save As…/Save… or Open… when none is showing, goes
to the folder with Go to Folder, sets the name with `set_value` (never a path in the name field),
picks a matching format from the panel's format pop-up when the extension implies one, presses
Save or Open and waits for the panel to close. An existing file is refused with `file_exists`
(the panel stays open) unless `overwrite` is true. The result states the saved or opened path,
checked on disk for that one path only, and the app's window titles.

The panel runs in macOS's out-of-process panel service, which takes no keys Cua aims at a window
(Cua 0.34; upstream trycua/cua#4551 is open). Go to Folder therefore needs two desktop-scoped keys,
Command-Shift-G and Return, sent to the frontmost app: each goes only after the user paused (the
same yield as foreground delivery) and right after Cua confirmed the app is frontmost, otherwise
the call refuses with `user_active`. That is why the tool needs `full` control; the app stays in
front afterwards. Everything else in the panel is driven by element.

Coordinates and screenshots: parameter names follow Anthropic's computer toolset (`coordinate`,
`start_coordinate`, `region`, `scroll_direction`, `scroll_amount`, `text` for keys and click
modifiers). Screenshots are window-only at most 1568 px on the long edge (Cua's documented size,
passed explicitly because the driver setting may be native size) and re-encoded as JPEG at that
size; coordinates are in that screenshot's space, and a zoomed `region` does not change them.
Whole-screen actions are not exposed, so every call names an app window a grant can cover. Cua 0.34
has no batch tool, so there is no `computer_batch`.

Element indexes are Glade's, not Cua's: an element keeps its index across reads and actions of the
same window (identity is the role and label path plus position among identical siblings) and an
index is never reused, so a stale one is refused rather than hitting another element.

Results:

- Every action reports Cua's effect and evidence, and, when the agent has read the window before
  and Cua did not confirm the effect by reading the element back, re-reads it 150 ms later (and
  once more 450 ms after that when nothing changed yet, since sheets animate in) and lists what
  changed: one line counting new, changed and gone elements, then at most ten of them (`~` new
  value or state first, then `+` new, `-` gone; elements with neither label nor value are counted
  but not listed). The menu bar is left out of the change list. New and gone elements are only listed when both reads covered
  the whole window. The re-read includes a screenshot at the same size, discarded, because a
  tree-only read would replace the screenshot Cua maps pixel coordinates through and the next pixel
  action would be refused (`screenshot_context_missing`). Text inputs and the window itself keep
  their index while their label changes (TextEdit reports a text area's contents as its label).
- Window reads collapse the menu bar to one line of menu titles and cut long labels and values
  (a text area's whole document) to an 80-character excerpt with the length.
- The same action with the same input that showed no effect (not confirmed and no tree change)
  twice in a row is refused with `no_progress` until the agent reads the app again or does
  something else. Glade never replays an action itself.
- Window titles and accessibility text reach the model inside nonce-delimited `APP_CONTENT` blocks
  (the same envelope Browser Use uses for `PAGE_CONTENT`), a provenance cue rather than a security
  boundary. Action, window-read and verify results end with a `Window: <app> "<title>"` line
  outside the block because the chat timeline reads it.
- A turn returns at most 60 images. This is a runaway guard, not a context budget: Claude and Codex
  own their history and compact it.

## Platforms

Computer Use runs wherever the pinned Cua release has a build: macOS (one universal executable),
Windows x64 and arm64, Linux x64 and arm64. There is no Glade-side platform gate beyond driver
availability; Settings states each platform's limits.

| Platform | Permissions                                   | Delivery                                                                            |
| -------- | --------------------------------------------- | ----------------------------------------------------------------------------------- |
| macOS    | Accessibility and Screen Recording, for Glade | Background for most apps; foreground when Cua escalates (drags, some Chromium apps) |
| Windows  | None                                          | Actions that need the real pointer or keyboard bring the window to the front        |
| Linux    | None                                          | X11 background input (see below); Wayland supports accessibility-tree actions only  |

On X11, Cua 0.34 sends key presses, scrolling and right-clicks to GTK apps in the background only
when it can write to `/dev/uinput` (Xvfb and VNC servers cannot take such a device); otherwise they
are refused with `background_unavailable` and need foreground delivery, which takes full control.
Clicks, typing, values and menus go through AT-SPI and stay in the background.

A GTK3 menu item that opens a modal dialog (Mousepad's File ▸ Save As…) freezes the app when it is
run through AT-SPI's action, as `computer_menu` does: the dialog draws but takes no input and the
app stops answering AT-SPI until it is killed. This reproduces with a bare AT-SPI client and no Cua
running. The same dialog opened by its shortcut works, including `set_value` on its name field.

macOS has been verified end to end, and Linux arm64 on X11 (XFCE on Xvfb, in a container; see the
plan's Linux results). A Linux x64 AppImage on a real desktop, Wayland and Windows are open release
checks.

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
   covers the grant gate, the app category tiers (including the file dialog's full-control rule and
   the browser launch rule),
   the progress guard and the clipboard read consent per permission mode.
3. Launch the Dev app through LaunchServices, grant both permissions, and confirm Settings shows the
   driver ready. Turn on `/computer` in a chat, grant TextEdit and ask the agent to type a sentence
   and read it back, then exercise a screenshot and a zoomed region. Save the document into a scratch folder
   with `computer_file_dialog`, once more under the same name (refused with `file_exists`), and open
   a PDF in Preview with it. Quit Preview and open the PDF with `computer_open_app` (launched, the
   target's window confirmed), again while it runs (reused), and try a `tel:` target (refused). Copy text with
   `computer_clipboard_write`, paste it into TextEdit with Edit > Paste and read it back (a card
   asks first outside Full access), and resize the TextEdit window with `computer_window_frame`.
4. Kill the `cua-driver` process: Settings recovers with a new generation within a few seconds.
   Quitting Glade stops the daemon and the proxy.
5. While an agent works in TextEdit, press the kill switch: the turn stops as with Stop. Ask for
   typing in Terminal under `act` (refused) and a click in Safari (refused).

## Licenses

The bundled driver and SDK are MIT licensed ([notice](licenses/cua-driver.md)); the SDK's Node runtime is MPL-2.0 ([notice](licenses/cua-driver-node-runtime.md)).
