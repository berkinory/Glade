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
  their own pointer cursor or an explicit tab stop are listed as `clickable`. Scroll containers
  (`overflow` auto, scroll or overlay with content past their box, read from the same DOMSnapshot
  with `includeDOMRects`) are listed with a ref, as `scrollable` when generic, with how far they
  are scrolled (`37% scrolled`), so `browser_scroll` can target a sidebar or a virtualized list.
  Invalid fields carry `invalid="…"`: an explicit `aria-invalid`, or a native constraint failure on
  a field that has a value or that the user touched (`:user-invalid`); the message is the
  `aria-errormessage` text, else the browser's `validationMessage` (never for passwords), else the
  `aria-describedby` text, read once per renderer. Names and values are
  cut at 100 characters, long `<select>`s show their first five options, and password values are
  never emitted (a filled one shows `filled`). A ref is keyed by (CDP session, backend node id) and
  belongs to its frame's document: it survives DOM updates, dies when that frame commits a new
  document (main frame, same-process or out-of-process iframe), and numbers are never reused. A
  stale ref is an error, never a guess. Lines of elements first listed since the previous snapshot
  start with `+`. Long trees stop at whole lines with a hint to narrow by `depth` or `ref`, so no
  ref is ever cut.
- **Actions.** An action resolves its ref to a box (scrolling it into view; no box is
  `not_visible`) and hit-tests the click point in the element's own frame with
  `DOM.getNodeForLocation` (center first, then four inset points; the call takes document
  coordinates, so the frame's scroll offset is added). A hit on the element, its descendants or
  its label is clicked. A hit on a close wrapper that holds no other control and carries the click
  handler (inline, React or Vue props, or an `addEventListener` listener read through CDP) is
  clicked and the result says it went through that element; a covered label falls back to its
  control; an element under a sticky header or footer is aligned to the other viewport edges and
  tested again. Anything else fails with `covered`, naming the covering element, instead of
  clicking an overlay. When a single plain click through a wrapper leaves a checkbox, radio or
  switch provably unchanged, the control is clicked once from script; a toggle that changed is
  never clicked again. Then
  it dispatches real `Input.*` events and waits the way Chrome DevTools MCP does: up to 100 ms for a
  main-frame navigation to start (then up to 5 s for its load); otherwise for the requests the
  action itself started (sent before 150 ms after it ended; WebSocket, EventSource, media, prefetch
  and ping excluded) for up to 1 s (5 s for uploads), then until a `MutationObserver` installed
  before the action sees 100 ms without changes (capped at 3 s). It never waits for network idle
  and never pauses the page, which the user shares. The result is one line plus what changed: URL, title, how many
  interactive elements appeared, and notes for a new tab, a download or a dialog. Checkbox and
  radio clicks report the resulting state, and date and time inputs are set through the native
  value setter. Typed text is read back (a password field only reports lengths) and a mismatch is
  classified: a field that lost the start of the text or got it out of order (a script moving the
  caret) is refilled once at once and checked again, unless it is a typeahead; a `maxlength` cut
  and any other change are only reported. Typing into a combobox-like field (`role=combobox`,
  `aria-autocomplete`, a `list` attribute, or options appearing) waits up to 1.5 s for suggestions
  and lists the visible options with refs in the page content. A click on an option reads back
  the combobox that controls its listbox (or the focused one) after the page settles and says
  whether it took the choice. `browser_select` matches `<select>` options by value or by label
  ignoring case and spacing; on an ARIA listbox or combobox it opens the list (by click, then
  ArrowDown), clicks the options whose labels match (exact, else a unique partial match) and
  reads back what the widget shows. `browser_fill` sets several fields in one call, custom
  selects included.
- **Scrolling and finding.** `browser_scroll` sends a real wheel event over the page or the
  ref, waits for the animated scroll to stop, and reports the position of the element that
  scrolled (`4,800 of 319,520px (2%)`, or that it is already at the end) and how many elements with
  text appeared, listing the first eight by heading or first line in the page content (feeds that
  load on scroll, virtualized rows). `browser_find` gives each match inside a row, list item,
  article, tree item or option that container's text as one capped context line; with no match it
  says whether the document is still loading, how many screens continue below the viewport, or
  that the viewport is at the end.
- **Coordinates, hover and drag.** `browser_click`, `browser_hover` and each end of `browser_drag`
  take either a ref or `x`/`y`. Points are in the pixels of the tab's latest agent
  `browser_screenshot` (each tab keeps that screenshot's viewport rect and image size, so a
  downscaled or element screenshot maps back to viewport CSS pixels); before any screenshot they are
  viewport CSS pixels. A point is not hit-tested against overlays: it clicks whatever is there, and
  the result names what it hit (`<canvas#game> at (310, 140)`). The virtual mouse stays where the
  last action left it and snapshots never move it, so a CSS `:hover` menu opened by
  `browser_hover` stays open for the next snapshot and click. `browser_drag` presses, moves in ten
  steps and releases; with `Input.setInterceptDrags` on, a page `dragstart` turns the rest of the
  gesture into `Input.dispatchDragEvent` dragEnter, dragOver and drop with the page's drag data
  (Chromium never starts HTML5 drag and drop from synthetic mouse events alone), and pointer-driven
  drags get the plain mouse events. `browser_find` also matches plain text in no listed control
  and returns a ref for the element that renders it, so a hover trigger without a role or pointer
  cursor can still be targeted by text.
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
`browser_click`, `browser_hover`, `browser_drag`, `browser_type`, `browser_fill`, `browser_press`,
`browser_select`, `browser_scroll`, `browser_screenshot`, `browser_dialog`, `browser_upload`,
`browser_console`, `browser_network` and `browser_batch` (an ordered list that stops at the first
failure). Action results are one line naming the element plus what changed; they never embed a
new snapshot. Other results end with the tab's URL and title. `browser_get_text` reads the main
content or, with a ref, that element's subtree. Console and network reads return 20 entries per
page, newest page first, and group repeated console messages.
`browser_evaluate` is not listed and always refuses until a per-chat setting exists. For Claude,
`browser_navigate`, `browser_snapshot`, `browser_find`, `browser_click`, `browser_type` and
`browser_fill` are marked `anthropic/alwaysLoad` so the core loop needs no tool search; the rest
stay deferred.

Everything a result takes from the page (snapshot lines, find matches, page text, console and
network output, a dialog's message, tab titles in the tab list) is wrapped in a block that starts
with `--- PAGE_CONTENT nonce=<random> origin=<page origin> ---` and ends with the same nonce. The
nonce is fresh per block, so a page cannot close the block early; the harness guidance tells the
model that text inside is data, never instructions. This is a provenance cue for the model, not a
security boundary. Glade's own report lines (what an action did, scope notes, page counts, and the
`Host:` line input actions end with for the chat timeline) stay outside the block.

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

- Blocked by host policy, not the model: tabs and popups load only `http:` and `https:` pages
  (and `about:blank`); iframes may also hold `data:`, `blob:` and `about:` documents; no request at
  all may use `file:`, `chrome:`, `chrome-extension:`, `devtools:`, `view-source:` or `javascript:`.
  Link-local addresses (169.254.0.0/16, fe80::/10, including their IPv4-mapped forms), cloud
  metadata hosts (`metadata.google.internal`, `metadata.goog`, `metadata`, `instance-data`,
  100.100.100.200, 192.0.0.192, fd00:ec2::254) and Glade's own backend and dev UI ports on
  loopback are refused. The check runs in the partition's single `onBeforeRequest` listener, so
  redirects, popups, frames, fetches and service worker requests are covered (verified with a
  redirecting popup and a service worker fetch); a blocked main-frame load adds a note to the
  agent's next result. Every loopback spelling counts (`localhost.`, `127.1`, `0.0.0.0`,
  IPv4-mapped IPv6). Other loopback ports and private LAN addresses stay reachable for testing
  local dev servers. Host names are checked as written: a public name that resolves to a blocked
  address is not caught.
- A built-in content blocker, on by default (Settings > Browser & Computer Use), runs
  Ghostery's engine with its full prebuilt list set: EasyList, EasyPrivacy, Peter Lowe's list and
  uBlock Origin's filters, privacy, unbreak and cookie-notice/annoyance lists. It applies to agent
  and panel alike. The compiled engine is cached as `content-blocker/engine.bin` in Electron's user
  data folder and rebuilt from the lists in the background once a day (an hour after a failed
  try); startup never waits for it, so a fresh offline install simply runs unblocked until the
  lists arrive. Network blocking is the second half of the partition's single `onBeforeRequest`
  listener (Electron allows one per session; the URL policy runs first and its cancel is final)
  plus its single `onHeadersReceived` listener. Element hiding (cookie banners) needs Ghostery's
  vetted preload in every frame: it is registered on the browser partition only while the blocker
  is on, runs in the preload's isolated world of the sandboxed, context-isolated views, and calls
  two Ghostery IPC channels whose handlers ignore any sender outside the partition. The lists
  exempt local addresses from element hiding, so dev servers render as written. License notice:
  [licenses/ghostery-adblocker.md](licenses/ghostery-adblocker.md).
- Pages get no permissions: microphone, camera, geolocation, notifications, devices and external
  protocol launches (`mailto:` and app links) are all denied.
- Security checks are the user's. After every action and snapshot Glade looks for a vendor
  challenge frame (Turnstile, reCAPTCHA, hCaptcha, Arkose, DataDome, PerimeterX or a generic
  CAPTCHA URL; invisible-mode widgets excluded) whose `<iframe>` shows at least 1,000 CSS px² on
  screen, found through the main frame tree and the attached out-of-process iframe targets (so
  one in a closed shadow root counts). The result then carries a `Challenge:` line telling the
  model to hand over, and the panel shows the user an OK-only notice through the page dialog bar
  (type `challenge` in the tab state) until the page navigates or the user dismisses it. It does
  not block agent tools. Glade never clicks, solves or works around a challenge.
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
