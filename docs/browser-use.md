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
- **Snapshots and refs.** `browser_snapshot` turns `Accessibility.getFullAXTree` into compact text
  with `ref=eN` handles. Refs stay valid until the main frame navigates; a stale ref returns an
  error telling the model to snapshot again. Long trees stop at whole lines with a hint to narrow by
  `depth` or `ref`, so no ref is ever cut. Actions resolve a ref to a box and dispatch real
  `Input.*` events.
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
`browser_click`, `browser_hover`, `browser_type`, `browser_press`, `browser_select`,
`browser_scroll`, `browser_screenshot`, `browser_dialog`, `browser_upload`, `browser_console`,
`browser_network` and `browser_batch` (an ordered list that stops at the first failure). Action
results are one line naming the element, plus URL and title; they never embed a new snapshot.
`browser_evaluate` is not listed and always refuses until a per-chat setting exists.

## Panel

The browser panel docks beside the chat; the header globe button and the `browser.toggle` shortcut
open it. It has a tab strip, an address bar, a line showing what the agent is doing with Stop, and
an element picker. Picking uses CDP inspect mode: the picked element joins the same ref table the
agent uses and lands in the composer as a chip with its role, name and URL, with its screenshot
attached. The panel stays interactive while the agent works: agent calls wait briefly (up to 3 s)
while the user is clicking or typing in the page. Tab state reaches the web through the
`browser.subscribeTabs` WebSocket subscription; native view placement is one IPC message.

## Policy and limits

- Blocked by host policy, not the model: `file:`, `chrome:`, `chrome-extension:`, `devtools:`,
  `view-source:` and `javascript:` URLs, and Glade's own backend and dev UI ports on loopback. The
  check runs on every request of the browser partition, so redirects, frames and fetches are
  covered. Other loopback ports stay reachable for testing local dev servers.
- There is no credential vault. When a page needs a sign-in, the agent says so and the user signs
  in inside the panel; credentials never pass through Glade or the model.
- Page dialogs are disabled: Electron dismisses them and the tool result reports what the page
  asked. `browser_dialog` arms a one-shot answer for the next alert, confirm or prompt, and the
  agent repeats its action. The panel offers no dialog prompts.
- Downloads go to `<workspace>/.glade/downloads/`. Uploads accept only regular files inside the chat
  workspace. Popups open as tabs and keep `window.opener`, so sign-in popups work.
- Console and network logs are ring buffers of 500 entries per tab, read on demand.
- Out-of-process iframes can be read and clicked but not picked. Keyboard shortcuts do not reach
  Glade while focus is inside a page.

## Verifying

`bun run check`, then the existing gateway tests (`apps/server/src/agentGateway/mcpTransport.test.ts`,
`httpRoute.test.ts`) and the host RPC authentication test
(`apps/desktop/src/hostRpc/desktopHostRpcServer.test.ts`). In the Dev app, ask an agent to open a
documentation site, find and click a link, fill a search form, take a screenshot and read the
console, with the panel both open and closed.
