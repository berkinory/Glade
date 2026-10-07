# Browser Use

Browser Use gives agents a real browser inside the desktop app. Each chat has its own tabs, which
share cookies and sign-ins with the browser panel the user sees. It exists only in the desktop
app and is exposed to every provider as `browser_*` gateway tools.

## Architecture

- **Desktop host (`apps/desktop/src/browser`).** Every tab is an Electron `WebContentsView` on the
  persistent `persist:glade-browser` partition. Views start detached at 1280×800 and keep running
  while hidden (`backgroundThrottling: false`), so the agent can snapshot and screenshot with the
  panel closed. Automation uses raw Chrome DevTools Protocol through `webContents.debugger`,
  attached on the first agent call, with iframe auto-attach and one command queue per tab. Tabs
  belong to one chat and live until the app quits; they are not stored.
- **Snapshots and refs.** `browser_snapshot` merges `Accessibility.getFullAXTree` with one
  `DOMSnapshot.captureSnapshot` per renderer (layout, paint order, a few computed styles) into
  compact text with `ref=eN` handles. By default it covers the viewport plus one screen (800 CSS px)
  above and below and ends with a note counting the interactive elements left out above and below;
  `scope: "page"` lists everything. Hidden content never reaches the model: invisible, zero-opacity
  and off-screen (pushed past the top or left edge) nodes are dropped, as are elements fully covered
  by an opaque layer that paints above them (a modal or cookie banner; a fixed full-screen backdrop
  also hides what is scrolled away under it). Styled checkboxes and radios stay listed even when the
  input itself is invisible. Elements the tree calls plain containers but that have a click listener,
  their own pointer cursor or an explicit tab stop are listed as `clickable`. Names and values are
  cut at 100 characters, long `<select>`s show their first five options, and password values are
  never emitted (a filled one shows `filled`). A ref is keyed by (CDP session, backend node id) and
  belongs to its frame's document: it survives DOM updates, dies when that frame commits a new
  document (main frame, same-process or out-of-process iframe), and numbers are never reused. A
  stale ref is an error, never a guess. Lines of elements first listed since the previous snapshot
  start with `+`. Long trees stop at whole lines with a hint to narrow by `depth` or `ref`, so no
  ref is ever cut.
- **Actions.** An action resolves its ref to a box (scrolling it into view; no box is
  `not_visible`), hit-tests the click point in the element's own frame with
  `DOM.getNodeForLocation` (center first, then four inset points) and fails with `covered`, naming
  the covering element, instead of clicking an overlay; a hit on the element's label counts. Then
  it dispatches real `Input.*` events and waits the way Chrome DevTools MCP does: up to 100 ms for a
  main-frame navigation to start (then up to 5 s for its load), otherwise until a
  `MutationObserver` installed before the action sees 100 ms without changes (capped at 3 s). It
  never waits for network idle. The result is one line plus what changed: URL, title, how many
  interactive elements appeared, and notes for a new tab, a download or a dialog. Checkbox and
  radio clicks report the resulting state, typed text is read back (a password field only reports
  its length), date and time inputs are set through the native value setter, and `<select>`
  options match by value or by label ignoring case and spacing. `browser_fill` sets several fields
  in one call.
- **Server (`apps/server/src/browser`, `apps/server/src/desktopHost`).** `DesktopHostClient` holds
  the RPC connection and reconnects with backoff; `BrowserHost` makes typed browser calls and keeps
  the latest tab list per chat. The gateway passes the chat from the session lease, never from
  tool input, and the desktop only resolves that chat's tabs.

### Desktop host RPC

The desktop and the server talk over one JSON-RPC 2.0 channel on `node:net`: a unix socket in a
fresh 0700 temp directory on macOS and Linux, a randomly named pipe on Windows. Frames carry a
4-byte big-endian length and are capped at 16 MiB. The desktop passes the path in
`GLADE_DESKTOP_HOST_RPC_PATH` and a random capability token over an extra stdio pipe
(`GLADE_DESKTOP_HOST_RPC_TOKEN_FD`); the server reads both at startup, so provider processes never
inherit them. The first frame must authenticate with that token or the socket closes. The same
channel carries `browser.*` methods, the `browser.tabsChanged` notification and the Computer Use
messages described in [Computer Use](computer-use.md). Schemas live in
`packages/contracts/src/desktopHost` and `packages/contracts/src/browser`; the frame codec in
`packages/shared/src/desktopHost`.

## Tools

`browser_tabs`, `browser_navigate`, `browser_snapshot`, `browser_find`, `browser_get_text`,
`browser_click`, `browser_hover`, `browser_type`, `browser_fill`, `browser_press`, `browser_select`,
`browser_scroll`, `browser_screenshot`, `browser_dialog`, `browser_upload`, `browser_console`,
`browser_network` and `browser_batch` (an ordered list that stops at the first failure). Action
results are one line naming the element plus what changed; they never embed a new snapshot. Other
results end with the tab's URL and title. Console and network reads return 20 entries per page,
newest page first, and group repeated console messages.
`browser_evaluate` is not listed and always refuses until a per-chat setting exists.

Everything a result takes from the page (snapshot lines, find matches, page text, console and
network output, a dialog's message, tab titles in the tab list) is wrapped in a block that starts
with `--- PAGE_CONTENT nonce=<random> origin=<page origin> ---` and ends with the same nonce. The
nonce is fresh per block, so a page cannot close the block early; the harness guidance tells the
model that text inside is data, never instructions. This is a provenance cue for the model, not a
security boundary. Glade's own report lines (what an action did, scope notes, page counts) stay
outside the block.

## Panel

The browser panel docks beside the chat; the header globe button and the `browser.toggle` shortcut
open it. It has a tab strip, an address bar, a line showing what the agent is doing with Stop, and
an element picker. Picking uses CDP inspect mode: the picked element joins the same ref table the
agent uses and lands in the composer as a chip with its role, name and URL, with its screenshot
attached. The panel stays interactive while the agent works: an agent call that arrives within
1.5 s of the user's last click, key or wheel event in that tab waits until the user pauses for
1.5 s (at most 2 s) and its result says the user was active. While the user is picking an element,
agent input on that tab fails with `user_picking` instead of moving the page under them. Tab state reaches the web through the
`browser.subscribeTabs` WebSocket subscription; native view placement is one IPC message.

## Policy and limits

- Blocked by host policy, not the model: `file:`, `chrome:`, `chrome-extension:`, `devtools:`,
  `view-source:` and `javascript:` URLs, and Glade's own backend and dev UI ports on loopback. The
  check runs on every request of the browser partition, so redirects, frames and fetches are
  covered. Every loopback spelling counts (`localhost.`, `127.1`, `0.0.0.0`, IPv4-mapped IPv6).
  Other loopback ports stay reachable for testing local dev servers.
- Pages get no permissions: microphone, camera, geolocation, notifications, devices and external
  protocol launches (`mailto:` and app links) are all denied.
- There is no credential vault. When a page needs a sign-in, the agent says so and the user signs
  in inside the panel; credentials never pass through Glade or the model.
- Page dialogs wait for an answer instead of blocking anything. Glade replaces Electron's
  internal `-run-dialog` handler on each browser view (with `disableDialogs` kept as the fallback
  if that internal event ever changes), so an alert or confirm pauses only its page. A dialog the
  agent's action opens is that action's result; until `browser_dialog` answers it, other page
  tools refuse with `dialog_open` (tabs, navigation, console and network keep working). A dialog
  that opens within 2 s of the user's own input in the tab belongs to the user: the agent cannot
  answer it or navigate away from it. The panel shows every open dialog above the page with OK and
  Cancel. Electron refuses `prompt()` in the page itself.
- Downloads go to `<workspace>/.glade/downloads/`; a symlinked `.glade` or `downloads` folder
  cancels them. Uploads accept only regular files inside the chat workspace. Popups open as tabs and keep `window.opener`, so sign-in popups work.
- Console and network logs are ring buffers of 500 entries per tab, read on demand.
- Each call on a tab gets 12 s (longer for navigation and settling actions). A page that stops
  answering has its script terminated, or is crashed and reloaded if it keeps blocking.
- Archiving or deleting a chat closes its tabs.
- Out-of-process iframes can be read and clicked but not picked. Keyboard shortcuts do not reach
  Glade while focus is inside a page.

## Verifying

`bun run check`, then the existing gateway tests (`apps/server/src/agentGateway/mcpTransport.test.ts`,
`httpRoute.test.ts`) and the host RPC authentication test
(`apps/desktop/src/hostRpc/desktopHostRpcServer.test.ts`). In the Dev app, ask an agent to open a
documentation site, find and click a link, fill a search form, take a screenshot and read the
console, with the panel both open and closed.
