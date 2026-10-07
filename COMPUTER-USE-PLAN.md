# Computer Use and Browser Use rewrite

Status: in progress on `feat/computer-use-rewrite`. This file is the single source of truth for the rewrite until it ships. It follows [AGENTS.md](AGENTS.md); where this plan is silent, AGENTS.md rules apply.

## 1. Decision

Delete the current Browser Use and Computer Use implementations completely, then rebuild both on a smaller, provider-agnostic design:

- **Computer Use** runs on the upstream **Cua Driver** binary, pinned and unpatched. Glade embeds it through its documented embedding surface and never builds it from source again.
- **Browser Use** runs on Electron **`WebContentsView` + raw Chrome DevTools Protocol** through `webContents.debugger`. No Playwright fork, no third-party driver.
- Both surfaces are exposed to every provider as MCP tools through the existing agent gateway. Claude and Codex are the acceptance targets.

This is a teardown and rewrite, not a refactor. Nothing from the old modules is ported by copy. Old identifiers, protocol fields, docs and tests are gone after Phase 1; the new code may only reuse an old idea when the plan below names it.

### Non-goals

- Supporting pre-rewrite persisted computer state or audit history. The baseline schema has no computer or browser tables; nothing user-owned is lost.
- Cua Spaces, Cua Perception (AGPL component), WebMCP in the first release.
- A credential vault. The shared browser session already carries the user's logins; when a page needs a sign-in the agent says so and waits, and the user signs in inside the panel. Credentials never pass through Glade or the model.
- Any new test harness, browser E2E suite or fixture framework.

## 2. What goes away

Everything below is deleted in Phase 1. Searches for leftovers run on the names `cua`, `Cua`, `computer`, `Computer`, `browserAutomation`, `BrowserAutomation`, `browserUse`, `browser_`, `betterwright`, `vault`, `Vault`, `webMcp`, `WebMcp`, `annotation` (browser scope only).

| Area                 | Paths                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop browser      | `apps/desktop/src/browser/**`, `apps/desktop/src/browserAnnotations/`, `apps/desktop/src/browserAutomation/`, `apps/desktop/src/browserWebMcp/`, `apps/desktop/scripts/browser-lifecycle-smoke.ts`, `apps/desktop/scripts/agent-browser/`, `apps/desktop/resources/agent-browser/`, the `smoke:browser-lifecycle` script and the `betterwright` dependency                                                                                                                                                                                                                                                                                                                                                 |
| Desktop computer     | `apps/desktop/src/computer/**`, `apps/desktop/src/cuaDriverHostStandalone.ts` and its tsdown entry, `apps/desktop/src/native/**`, `apps/desktop/native/computer/**`, `apps/desktop/patches/cua-driver/**`, `apps/desktop/scripts/{provision-cua-driver,find-cua-artifact,cua-cache-key,cua-artifact-provenance,build-computer-helper}.mjs` and their tests, `apps/desktop/scripts/cua-private-worker/`, `apps/desktop/resources/cua-driver/`                                                                                                                                                                                                                                                               |
| Desktop wiring       | browser and computer sections of `apps/desktop/src/main/ipc/ipcChannels.ts`, `registerDesktopIpc.ts`, `preload.ts`, `createDesktopRuntime.ts`, `main.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Server               | `apps/server/src/computer/**`, `apps/server/src/browserAutomation/**`, `apps/server/src/browser/**`, `apps/server/src/agentGateway/{browserTools,browserProof,computerTools,computerBrowserTools,computerBrowserEffect,computerSpaceTools,computerGuidance,computerApprovalDisplay,computerForegroundConsent,computerProgressGuard,computerToolPermission}.ts` and their tests, `apps/server/src/agentGateway/browser/`, the browser and computer paragraphs of `harnessPolicy.ts`, computer and browser cases in `apps/server/src/server/ws/wsRpc.ts`, `serverLayers.ts` entries                                                                                                                          |
| Server orchestration | `enableComputerControl`, `computerControlMode`, `computerControlGeneration` in `packages/contracts/src/orchestration/commands.ts`, `ThreadSessionSettings` computer accessors, computer branches in `providerCommands/*` and `ProviderRuntimeIngestion.ts`, `decider.computerControl.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                              |
| Providers            | `shouldAllowGladeComputerProviderTool` use in `codexAppServerManager.ts`, computer-specific hooks in `provider/claude/adapter/sdkHooks.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Contracts            | `packages/contracts/src/browser/**`, `packages/contracts/src/computer/**`, `packages/contracts/src/transport/ws/computerRpc.ts`, `browser.toggle` keybinding stays (reused)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Shared               | `packages/shared/src/computer/**`, `packages/shared/src/browser/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Web                  | every file listed by `find apps/web/src -iname '*browser*' -o -iname '*computer*'`, `browserStateStore.ts`, `computerStateStore.ts`, `computerControlMode.ts`, chat cards `Computer*Card.tsx`, `ComputerPreviewPopover*`, `FloatingBrowserPanel*`, `BrowserAnnotation*`, `ComposerComputerControlEffortHint.tsx`, settings `Computer*` panels and the `computer` entry in `settingsNavigation.ts` and `settingsSearchIndex.ts`, the `computer-use` slash command, browser and computer mentions in `composer-editor-mentions.ts`, `brandIcons.tsx`, `serviceBrandArtwork.ts`, `slashCommandIcons.ts`, `wsNativeApiBrowser.ts` and the browser and computer parts of `wsNativeApi.ts` and `nativeApi` types |
| CI                   | `.github/workflows/{cua-linux-check,cua-native-check,cua-release-cache}.yml`, `.github/actions/{prepare-cua-source,provision-cua}`, the provision step in `release-build.yml` and any `ci.yml` steps for the Swift helper or Rust toolchain                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Docs                 | `docs/computer-use-cua/**`, computer and browser sections of `docs/desktop-runtime.md`, `docs/provider-architecture.md`, `docs/glade-feature-scope.md`, `docs/release.md`, `docs/ci.md`, `docs/workspace-layout.md`, `docs/dependencies.md`, `docs/icon-assets.md`, `docs/README.md`                                                                                                                                                                                                                                                                                                                                                                                                                       |

Keep untouched: `apps/server/src/visualReplies/**` (Puppeteer headless shell for visual replies is unrelated), the agent gateway itself (`mcpTransport`, `httpRoute`, `sessionLease`, credentials, discovery, thread tools, visual reply tools), the desktop WS bridge.

## 3. Target architecture

### Ownership

```
packages/contracts/src/browser/     tool input schemas, ref grammar, host method params/results
packages/contracts/src/desktopHost/ host RPC env names, auth, framing limits
packages/contracts/src/computer/    driver connection notification, JPEG method, Computer Use mode, access-card contract
packages/shared/src/desktopHost/    frame codec (desktop + server)

apps/desktop/src/browser/           WebContentsView tabs, CDP sessions, snapshot engine and format, actions
apps/desktop/src/hostRpc/           desktop host RPC server (pure node:net) and its startup
apps/desktop/src/computer/          Cua embedded host: release manifest, binary check, lifecycle, permissions, JPEG encoding

apps/server/src/desktopHost/        DesktopHostClient service (RPC client, reconnect, notifications)
apps/server/src/browser/            BrowserHost service (typed browser calls over DesktopHostClient)
apps/server/src/computer/           ComputerHost (MCP client to Cua, sessions), ComputerAccess (grants, tasks, access cards), result decoders
apps/server/src/agentGateway/browser/   browser_* gateway tools + guidance
apps/server/src/agentGateway/computer/  computer_* gateway tools + guidance

apps/web/src/components/browser/    panel, tab strip, header, agent-activity indicator
apps/web/src/components/computer/   settings section, chat cards, activity preview
```

Durable truth and side effects stay in `apps/server`; the desktop owns native surfaces and nothing else; the web presents. Dependencies flow contracts → shared → apps. No barrel files. Folders instead of `x.a.ts` families.

### Transport

- **Server ↔ Desktop (host RPC, `desktopHostRpc`):** one JSON-RPC 2.0 channel over `node:net` (unix socket `host.sock` in a fresh 0700 temp dir on macOS/Linux, `\\.\pipe\glade-host-<random>` on Windows), 4-byte big-endian length-prefixed frames capped at 16 MiB. The desktop is the server and the Effect server the client. The socket path travels in `GLADE_DESKTOP_HOST_RPC_PATH`; a random 32-byte capability token travels over the backend's stdio fd 3 (`GLADE_DESKTOP_HOST_RPC_TOKEN_FD`), and the server consumes both at startup so provider processes never inherit them. The first frame must be `auth` with the token (constant-time compare) or the socket closes. Desktop → server events are JSON-RPC notifications on the same connection (`browser.tabsChanged` today). The client reconnects with capped exponential backoff. It carries the `browser.*` methods now and `computer.*` in Phase 5. One module per side (`desktopHostRpcServer.ts`, `desktopHostRpcClient.ts`), schemas in contracts.
- **Server ↔ Cua:** the desktop main process starts `EmbeddedCuaDriverHost` (only the permission-owning process may start the daemon) and publishes the returned `connection.mcp` (`command`, `args`, `environment`) plus its `generation` over the host RPC; it publishes again after every restart. The server launches exactly that stdio proxy and is an MCP client to it, and an MCP server to providers. No Glade code speaks Cua's socket protocol directly.
- **Desktop ↔ Web:** Electron IPC only for things the renderer must do synchronously with the native view (bounds, focus, visibility). Everything else flows server → web over the existing WS so that state has one owner.
- **Providers:** unchanged gateway injection (`buildClaudeMcpServers`, Codex gateway config). New tools register in `AgentGateway.ts` the same way thread tools do.

### Browser host design (desktop)

- One `WebContentsView` per tab, all on the persistent `persist:glade-browser` partition that the user also sees. The agent and the user share cookies and logins by construction. Tabs belong to one thread; the server passes the thread from the gateway session lease, never from tool input, and the desktop only resolves that thread's tabs. Tabs live for the app's lifetime, not in the database.
- Views start detached from any window at 1280×800 bounds: they lay out, run CDP and capture screenshots while hidden (`webContents.capturePage()` does not work detached, so it is only a fallback). `Emulation.setFocusEmulationEnabled` is on for every attached tab; without it the first mouse event to an unfocused view waits out Chromium's 5 s input-ack timeout.
- One `webContents.debugger` attachment per tab, attached lazily on the first agent call, detached when the tab closes. `Target.setAutoAttach({ autoAttach: true, flatten: true, waitForDebuggerOnStart: false })` for out-of-process iframes. One in-flight CDP command queue per tab; concurrent snapshot commands corrupt trees.
- `backgroundThrottling: false` on every browser view so screenshots never block when the panel is hidden.
- Snapshot engine: `Accessibility.getFullAXTree` → compact indented text with `ref=eN` refs keyed by `backendDOMNodeId` + frame id. Refs persist per tab until navigation commits; a stale ref returns a typed error that tells the model to snapshot again. `filter: interactive | all`, `depth`, `ref` subtree, hard cap with an explicit "narrow with depth or ref" tail. Never truncate in a way that drops refs.
- Actions resolve a ref to a box via `DOM.scrollIntoViewIfNeeded` + `DOM.getBoxModel`, then dispatch real `Input.*` events (file choosers and user activation need them). Typing uses `Input.dispatchKeyEvent` for printable keys and `Input.insertText` only for bulk text.
- Screenshots: `Page.captureScreenshot` with JPEG, optional ref or region clip (clip is in device-independent pixels), downscaled to a fixed longest edge. The tool description says screenshots are for seeing, not for coordinates, unless the tree lacks the element.
- Dialogs (revised in Phase 2): for a view without a window Electron shows JavaScript dialogs as a blocking native modal (`runModal`) that CDP's `Page.handleJavaScriptDialog` does not close, freezing the main process. Browser views therefore run with `disableDialogs: true`: Electron dismisses every dialog at once, CDP still reports `Page.javascriptDialogOpening`, and the tool result says what the page asked. `browser_dialog` arms a one-shot answer for the next alert/confirm/prompt in the main frame (a minimal override of `window.confirm`/`alert`/`prompt` set through `Runtime.evaluate`, gone on navigation); the model then repeats the action. Electron has no native `prompt()`, so only an armed answer can satisfy one. Phase 4 must decide how the user answers dialogs in the visible panel. Downloads go through `session.on("will-download")` to `<workspace>/.glade/downloads/` (with a `*` `.gitignore`); the server sends the workspace with each call that may create a tab. Popups arrive through `setWindowOpenHandler` and `createWindow` adopts Electron's guest `WebContents`, so `window.opener` keeps working for sign-in popups; the popup becomes the thread's active tab. File uploads set files directly on an `<input type=file>` ref, or arm `Page.setInterceptFileChooserDialog` before clicking any other ref and fill the intercepted chooser; the server first resolves every path, after symlinks, to a regular file inside the thread workspace.
- Console and network buffers are ring buffers per tab (500 entries), read on demand, bodies opt-in. The console buffer resets when the main frame commits a navigation.
- Human takeover: the panel is always interactive. The host records the last human input time; tool calls during active human input wait briefly, then proceed with a notice. No locks, no "human control mode".
- Element picking: the user can point at an element and send it to the composer. This uses `Overlay.setInspectMode` and `Overlay.inspectNodeRequested` on the tab's CDP session; the returned `backendDOMNodeId` becomes a ref in the same table the agent uses, so the composer receives `ref=eN`, role, name and an optional clipped screenshot. No injected page script, no guest preload, no custom overlay.

### Computer host design (desktop + server)

- The desktop vendors the signed upstream `cua-driver` executable per platform and architecture, outside ASAR, with its executable bit and code signature preserved. A manifest in `apps/desktop/src/computer/cuaRelease.json` (only the desktop runtime and its fetch script read it) records version, the upstream release URL, and per artifact the `-binary` archive name and SHA-256 plus the extracted executable's SHA-256. A build script downloads and verifies; nothing compiles Rust.
- The desktop starts the driver with the upstream embedded-host entry point so Accessibility and Screen Recording grants attach to Glade's signing identity. It publishes `computer.connection` (`{state: "ready", generation, driverVersion, mcp}` or `{state: "unavailable", reason, message}`) over the host RPC after every change and whenever a backend authenticates.
- Permission checks, setup guidance and "open System Settings" actions come from the upstream `/electron` entry point; Glade keeps no Swift helper.
- The server `ComputerHost` service holds: availability and health, per-thread opt-in, the approval lease (which app or window the agent may act on, granted by the user from a chat card), and the active task for Stop. It proxies tool calls to Cua, enforcing ownership and approval before dispatch and classifying results with Cua's `effect` / `escalation` fields.
- Stop and the Escape key cancel through Cua's cancellation, which releases held input. Glade adds no second kill switch.

### Tool surface

Names are canonical gateway names; providers may prefix them.

**Browser** (always loaded when the gateway is available):

| Tool                                 | Notes                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `browser_tabs`                       | list / open / close / select; returns tab ids, URLs, titles                                                   |
| `browser_navigate`                   | `url`, or `back`, `forward`, `reload`; waits for load or a bounded timeout; returns URL, title and any dialog |
| `browser_snapshot`                   | `filter`, `depth`, `ref`; the only tool that returns the tree                                                 |
| `browser_find`                       | text or regex over role, name and text; ≤20 refs with one line of context each                                |
| `browser_get_text`                   | readable main text, markdown-ish, capped                                                                      |
| `browser_click`                      | `ref`, `button`, `modifiers`, `count` (1–3)                                                                   |
| `browser_hover`                      | `ref`                                                                                                         |
| `browser_type`                       | `ref?`, `text`, `submit?`; focuses the ref when given                                                         |
| `browser_press`                      | key chord, `repeat`                                                                                           |
| `browser_select`                     | `ref`, `values`                                                                                               |
| `browser_scroll`                     | `ref?` or direction + amount                                                                                  |
| `browser_screenshot`                 | `ref?`, `region?`, `scale?`; JPEG                                                                             |
| `browser_dialog`                     | accept / dismiss with optional text                                                                           |
| `browser_upload`                     | `ref`, `paths` within the workspace                                                                           |
| `browser_evaluate`                   | gated by a per-thread setting; off by default                                                                 |
| `browser_console`, `browser_network` | ring buffer reads, filters, bodies opt-in                                                                     |
| `browser_batch`                      | ordered list of the above, stops at first failure                                                             |

Action results are one line plus URL and title. They never embed a fresh snapshot.

**Computer** (listed only while the thread has Computer Use on; see Phase 6 revisions for the Cua mapping):

Two layers over the same Cua connection.

1. _Structured_ (primary): `computer_apps` (running apps and windows), `computer_window_state` (accessibility tree for a window, screenshot only when `include_screenshot: true`), `computer_act` (click, type, press, scroll, set value, menu, by `element_token` with `delivery: background | foreground`), `computer_request_access` (asks the user to grant an app or window), `computer_stop`.
2. _Pixel_ (fallback, Anthropic-shaped vocabulary): `computer_screenshot`, `computer_zoom`, `computer_left_click`, `computer_right_click`, `computer_double_click`, `computer_triple_click`, `computer_left_click_drag`, `computer_mouse_move`, `computer_scroll`, `computer_type`, `computer_key`, `computer_hold_key`, `computer_wait`. Coordinates are in the pixel space of the last returned screenshot; screenshots are downscaled before they leave the server and at most 20 are kept per turn context.

Guidance in `harnessPolicy.ts` says: prefer structured, screenshot only after an `unverifiable` or `refused` effect or when the tree lacks the target, zoom before taking a higher-resolution screenshot.

### Approval model

- Browser Use needs no approval beyond gateway availability. Host policy, not the model, blocks `file:`, `chrome:`, `chrome-extension:`, `devtools:`, `view-source:` and `javascript:` URLs and every request to Glade's own backend and dev UI ports on loopback (`webRequest.onBeforeRequest` on the browser partition, so redirects, frames and fetches are covered too). Other loopback ports stay reachable: testing the user's local dev servers is a core use case, so the original "block loopback" rule was revised in Phase 2.
- `browser_evaluate` is registered but hidden from `tools/list` and always refuses with `evaluate_disabled` until a per-thread setting exists. Phase 4 or 7 adds the setting UI, lists the tool when it is on, and adds the desktop `browser.evaluate` method.
- Computer Use is off per thread by default. The user turns it on with the `/computer-use` slash command (one request) or the thread setting (sticky). `computer_request_access` produces a chat card asking for a grant with scope `read`, `act` or `full`; grants live in server memory for the thread (no migration; a restart asks again) and are listed in Settings. The server refuses tool calls outside a grant with a typed error the model can read.
- Stop in the chat, or Escape while a task runs, cancels the task and clears foreground delivery for the turn.

## 4. Phases

Work happens in a dedicated worktree on branch `feat/computer-use-rewrite`, created from `main`. Each phase ends in one or more conventional commits and a green `bun run check`. Tests run only where the plan says so. Each phase's exit criteria must be met before the next starts.

```bash
git worktree add ../glade-cu -b feat/computer-use-rewrite main
```

### Phase 0: upstream spikes (throwaway, not committed to the branch)

Two half-day spikes in `apps/desktop/.spikes/` on the worktree, deleted before Phase 1.

- **Cua embedded host.** Install `@trycua/cua-driver` at the latest release, run the embedded host from a bare Electron main process on macOS, confirm: grants attach to the Electron identity, a loopback MCP URL + token is produced, `list_windows` and a window state round trip work, cancellation releases a held key. Record the exact package version, executable download URLs per platform and the MCP tool names the release exposes. This fixes the pin in `cuaRelease.json`.
- **CDP snapshot on `WebContentsView`.** Attach `webContents.debugger`, pull `Accessibility.getFullAXTree` with iframe auto-attach, build refs, click a ref through `Input.dispatchMouseEvent`, capture a clipped screenshot while the view is hidden. Record token size of a snapshot for three ordinary pages with `filter: interactive`.

Exit: both spikes work on macOS; findings recorded as a short section appended to this file.

### Phase 1: teardown

Delete every path in section 2. Fix compile errors by removing callers, not by stubbing. Remove dependencies (`betterwright`, Swift and Rust toolchain steps, Cua CI). Remove the `computer` settings page, slash command and chat cards. Remove orchestration command fields and the thread-settings accessors. Remove the `cua-driver` and `agent-browser` resources. Rewrite `docs/glade-feature-scope.md` to say Browser Use and Computer Use are being rebuilt and are unavailable on this branch.

Checks: `bun run check`, `bun run build:desktop`, launch the Dev app and send one Claude turn and one Codex turn that use a thread tool (gateway unaffected). `bun scripts/check-windows-runtime-boundary.ts`.

Commits: `refactor!: remove Browser Use and Computer Use implementations` (body states the line delta and that both features are rebuilt in later commits).

### Phase 2: browser host core

Build `apps/desktop/src/browser/`:

- `browserTabs.ts` (view lifecycle, partition, bounds, `backgroundThrottling: false`, popup handler, download handler)
- `cdp/cdpSession.ts` (attach, per-tab command queue, auto-attach for frames, detach on DevTools)
- `cdp/snapshot.ts` + `cdp/refs.ts` (tree → text, ref table, invalidation on `Page.frameNavigated` for the main frame)
- `cdp/actions.ts` (resolve ref → box → input events; type, press, select, scroll)
- `cdp/screenshot.ts`, `cdp/dialogs.ts`, `cdp/fileChooser.ts`, `cdp/buffers.ts` (console and network rings)
- `cdp/snapshotFormat.ts`, `cdp/keyboard.ts`, `cdp/pageText.ts`, `browserTab.ts` (per-tab state), `browserNavigation.ts`, `browserUrlPolicy.ts`, `browserHostDispatch.ts` (RPC method → module)
- `apps/desktop/src/hostRpc/desktopHostRpcServer.ts` (net pipe, token, framing, injected dispatch; no Electron import) and `startDesktopHost.ts`

Contracts: `packages/contracts/src/browser/browserTools.ts` (tool input schemas, `BrowserRef` grammar), `browserHost.ts` (method params, results, failure codes, `browser.tabsChanged`), `packages/contracts/src/desktopHost/desktopHostRpc.ts`. Shared: `packages/shared/src/desktopHost/frameCodec.ts`. The snapshot renderer stays in `apps/desktop/src/browser/cdp/snapshotFormat.ts` because the desktop is its only consumer; it moves to shared when the web highlights refs.

Checks: `bun run check`. Manual: a scratch script in the Dev app that opens a tab, snapshots, clicks a ref, types, uploads a file and screenshots with the panel hidden.

Commits: `feat(desktop): browser host over WebContentsView and CDP`, `feat(contracts): browser tool and host RPC schemas`.

### Phase 3: browser tools in the gateway

- `apps/server/src/browser/Services/BrowserHost.ts` + `Layers/BrowserHost.ts` (RPC client, reconnect, typed errors)
- `apps/server/src/agentGateway/browser/browserTools.ts` (one tool definition per table row, thin mapping to the host), `browserGuidance.ts` (the policy paragraph), registration in `AgentGateway.ts`
- `harnessPolicy.ts`: one paragraph for browser use, written fresh

Checks: `bun run check`; `apps/server/src/agentGateway/mcpTransport.test.ts` and `httpRoute.test.ts` (trust boundary tests that already exist). Then **provider acceptance in the Dev app**, same script for Claude and Codex: open a documentation site, find a link by text, click it, fill a search form, take a screenshot, read console. Record tokens per step from the provider usage panel.

Commits: `feat(server): browser_* gateway tools over the desktop browser host`.

### Phase 4: browser panel UI

Build `apps/web/src/components/browser/`:

- `BrowserPanel.tsx` (shell that hosts the native view bounds, dock only), `BrowserTabStrip.tsx`, `BrowserAddressBar.tsx`, `BrowserAgentActivity.tsx` (one-line "agent is clicking Sign in" indicator with a stop affordance)
- `BrowserPickElement.tsx` (toggle in the header; the desktop enters CDP inspect mode, the picked ref lands in the composer as a reference chip with role, name and screenshot). Desktop side: `cdp/pickElement.ts`, one IPC pair `browser.pick.start` / `browser.pick.result`.
- `browserPanelStore.ts` (panel open state and bounds only; tab state comes from the server over WS)
- Reuse `ui/*` primitives, `text-ui*` tokens, `disclosureMotion.ts`. Keyboard: existing `browser.toggle` keybinding.
- Server → web: tab list, active tab, navigation state and agent activity as one WS feature group `browser.*` in `wsRpc.ts` with a subscription, mirroring how other feature groups work.
- Chat: browser tool rows in the timeline render through the existing tool row classification with a compact result line; screenshots render as image attachments.

Checks: `bun run check`; visual check in the Dev app on light and dark, two font sizes; `bun run test` for `apps/web` only if a store contract changed.

Commits: `feat(web): browser panel for Browser Use`.

Revisions (as built):

- Tab state reaches the web as one WS group in `packages/contracts/src/transport/ws/browserRpc.ts` (`browser.subscribeTabs`, `browser.command`), merged into `WsFeatureRpcGroup`; handlers live in `apps/server/src/browser/browserWsHandlers.ts`. The server keeps the latest `browser.tabsChanged` list in a `SubscriptionRef` (`BrowserHost.threadTabs`) instead of fetching an initial list: the desktop re-sends the full list whenever a backend authenticates, so a subscriber always gets the current list first with no fetch-versus-notification race. The web reads the subscription directly in the panel; nothing is copied into a store.
- Panel commands (open, close, select, navigate) reuse `browser.tabs` and `browser.navigate` with `actor: "user"`, which skips the agent's wait for human input and leaves the agent's pending notices queued. Tool input decoding strips the field, so agents cannot set it.
- Native placement is one IPC message, `browser.placeView({threadId, tab: {tabId, bounds} | null})`, scaled by the page zoom in main. `BrowserViewSurface` shows at most one view per thread and hides a window's views when its renderer navigates. The renderer hides the view while a modal, a menu or popover over the panel, or a resize drag is showing, by watching the portal containers beside the app root; no menu component changes were needed.
- Element picking is `browser.pickElement` (invoke, resolves with the element or null) plus `browser.cancelPick`; Escape cancels from Glade or from the page. Out-of-process iframes are not pickable (inspect mode runs on the root target only). The pick enters the prompt as `[browser element tab=… ref=… role=… name=… url=…]`, rendered as a chip in the composer and in sent messages, and the element screenshot is attached as an image.
- Refs remember the role and name they were listed with, so action results read `Clicked button "Sign in" (e12).`; timeline rows show `Clicked button "Sign in" · example.com` through the Glade MCP tool presentations. Screenshots do not render in the timeline: provider ingress strips image bytes from activity payloads, so there is nothing to show without persisting images.
- The tool classification module referenced for timeline rows is not on this branch; rows use the existing Glade MCP presentation path.
- Panel open state is per thread and not persisted (tabs do not survive a restart either); its width is remembered. The panel is not a workspace tab and has no menu item: the header globe toggle and `browser.toggle` open it.
- Page dialogs stay dismissed and reported (Phase 2); v1 has no dialog UI for the user.

### Phase 5: Cua embedded host

Build `apps/desktop/src/computer/`:

- `cuaBinary.ts` (resolve per platform, verify SHA-256 against `cuaRelease.json`, refuse to start on mismatch)
- `cuaHost.ts` (start embedded host, surface MCP URL + token, restart with backoff, stop on quit)
- `cuaPermissions.ts` (upstream `/electron` permission functions wrapped in a tiny interface; IPC: `computer.permissions.get`, `computer.permissions.openSettings`)
- `apps/desktop/scripts/fetch-cua-driver.mjs` (download + verify into `resources/cua-driver/<platform>-<arch>/`), wired into `build:desktop` and the release workflow; a CI check that the manifest hashes match the download.

Server: `apps/server/src/computer/Services/ComputerHost.ts` + `Layers/ComputerHost.ts` (MCP client to Cua, health, availability), `computerGrants.ts` (per-thread grants and approval lease), `computerTask.ts` (active task, stop).

Checks: `bun run check`; Dev app on macOS: driver starts, permission state reflects System Settings, server reports availability. Pinned-version contract test (one file): decode `list_windows` and `get_window_state` fixtures captured from the pinned release, fail on shape drift.

Commits: `feat(desktop): embed the upstream Cua driver`, `feat(server): computer host over Cua MCP`.

Revisions (as built):

- Manifest lives in `apps/desktop` (desktop runtime + fetch script are its only readers). macOS uses the universal `-binary` archive for both architectures, so the directory is `resources/cua-driver/darwin-universal/`; others are `<platform>-<arch>`. Only the executable is extracted: it links system libraries only (`otool -L`), and the Windows `cua-driver-uia.exe` worker is reserved and default-off upstream. `fetch-cua-driver.mjs` runs before `dev` and `build` in `apps/desktop/package.json` and skips when a verified copy exists.
- Packaging: electron-builder `extraResources` copies `resources/cua-driver` to `Resources/cua-driver`; `mac.binaries` signs the executable with the app identity before the app; the SDK packages (`@trycua/**`, `@ubjs/**`) are unpacked from ASAR because the SDK hands dlopen a path next to its own files, and the desktop imports it from `app.asar.unpacked` by file URL (it is ESM only). Re-signing changes the bytes, so packaged macOS builds check that the executable is validly signed by the app's own team instead of the upstream hash; every other build checks the hash. `NSAccessibilityUsageDescription` and `NSScreenCaptureUsageDescription` are restored in `extendInfo`.
- The embedded host's environment is limited to Cua's allowlist, which rejects `DO_NOT_TRACK`: the daemon gets `CUA_DRIVER_RS_TELEMETRY_ENABLED=0`, the published proxy environment adds `DO_NOT_TRACK=1`. `noOverlay` stays default (agent cursor shown).
- Lifecycle: permissions are polled every 3 s on macOS (and re-read on every permissions IPC call); the driver starts once both grants are present, stops when one is revoked, restarts with 1–30 s backoff on unexpected exit (`waitForExit(generation)`), and stops as part of the desktop shutdown that already defers quit until the backend has exited.
- Permissions IPC: `desktop:computer-permissions-get`, `-request` (prompts Accessibility), `-open-settings` (Screen Recording pane, else Accessibility); bridge `window.desktopBridge.computer.{getPermissions, requestPermissions, openSettings}`, type `DesktopComputerPermissions`.
- Server: `ComputerHost` launches exactly the published proxy (shared process runtime, minimal inherited environment, supervised teardown) per generation, runs `check_permissions` + `health_report` on connect, relaunches a dead proxy, and exposes status. A minimal line-delimited JSON-RPC client replaces an MCP SDK dependency; giving up on a call sends `notifications/cancelled`. Cua binds a named session to the connection that created it and never revives an ended one from another, so `ComputerHost` gives each thread a session label unique to the current connection, rotates it after `end_session`, and retries once when Cua reports the session ended. JPEG encoding of screenshots runs on the desktop (`computer.encodeJpeg`, Electron `nativeImage`) because the server has no image codec.

### Phase 6: computer tools in the gateway

- `apps/server/src/agentGateway/computer/structuredTools.ts`, `pixelTools.ts`, `computerGuidance.ts`, registration gated on the thread's Computer Use setting
- Thread setting: `computerUse: "off" | "once" | "on"` on the thread session settings, set by `/computer-use` or the thread menu; replaces the three old command fields with one
- Approval: `computer_request_access` emits a domain event rendered as a chat card; the user's answer resolves the grant; refusals return typed errors
- Screenshot budget: downscale, JPEG, cap images per turn in `packages/shared/src/computer/screenshotBudget.ts`

Checks: `bun run check`; approval gate test (one file, trust boundary: an ungranted window is refused, a granted one passes, Stop clears). **Provider acceptance in the Dev app** for Claude and Codex: enable Computer Use for the thread, grant TextEdit, ask the agent to write a sentence and read it back via tree; then ask for a screenshot-driven task in an app without an accessibility tree (a canvas-heavy app) to exercise the pixel path and zoom.

Commits: `feat(server): computer_* gateway tools and per-thread Computer Use`.

Revisions (as built):

- Tools and their Cua mapping. Structured: `computer_apps` (list_apps + list_windows, no grant), `computer_window_state` (get_window_state; elements rendered as `[index] role "label" = value`, tokens kept server-side per thread and window; screenshot only with `include_screenshot`), `computer_act` (click, double_click, right_click, set_value, type_text, press_key/hotkey, scroll, invoke_menu, by element index, `delivery: background | foreground`), `computer_request_access`, `computer_stop` (end_session). Pixel, window-scoped: `computer_screenshot` (get_window_state without tree), `computer_zoom` (zoom), `computer_left_click`/`right_click`/`double_click`/`triple_click` (click count 3), `computer_left_click_drag` (drag, foreground only on macOS so it needs full), `computer_scroll`, `computer_type` (type_text), `computer_key` (press_key or hotkey), `computer_wait` (server sleep ≤ 10 s). Dropped: `computer_mouse_move` (Cua's window-scoped move_cursor moves only the agent overlay, no real hover) and `computer_hold_key` (no Cua equivalent). Desktop-scope (whole screen) actions are not exposed: every pixel tool names a pid and window so grants apply.
- Coordinates: screenshots are requested with `max_image_dimension: 1280` and re-encoded to JPEG at the same size; Cua maps its own downscaled screenshot space back to the screen, so no per-thread scale is tracked. At most 20 images per turn (`computerTask.ts`); past that, image tools refuse with `image_budget_exhausted`.
- Gate: thread from the session lease; Computer Use mode, then `list_windows({pid})` resolves the window's app, then the grant check (`read` for state/screenshot/zoom, `act` for input, `full` for foreground and drag). Refusals: `computer_use_off`, `window_not_found`, `access_required` (names the `computer_request_access` call), `unknown_element`, `stopped`, Cua's own `structuredContent.code`. Action results report Cua's `effect` and `escalation`; `refused` is an error.
- Setting: `thread.computer-use.set {threadId, computerUse: "off" | "once" | "on"}` → event `thread.computer-use-set` (not projected). The provider command reactor keeps the mode in `ThreadComputerUse` (in memory, shared with the gateway); `once` binds to the next turn start and turns off when that turn completes or aborts.
- Tool visibility: the gateway's MCP transport is POST-only, so it cannot push `notifications/tools/list_changed`, and both providers read `tools/list` once per session (Codex at thread start through its per-thread MCP config). Computer tools carry `listedFor` (mode ≠ off) and the reactor restarts the provider session, keeping its resume cursor, whenever the listed state differs from what the running session was provisioned with: immediately when the session is idle (as for a runtime-mode change), otherwise at the next turn start. The same mechanism applies to Claude and Codex.
- Access card: reuses the provider user-input card. `computer_request_access` appends a `user-input.requested` activity with `requestId: "computer-access:<uuid>"`, one question `{id: "computer-access", header: "Computer Use", options: "Allow read" | "Allow act" | "Allow full control" | "Deny"}` and an extra `computerAccess: {app, windowId, windowTitle, scope, reason}` for a dedicated card later. The web answers with the existing `thread.user-input.respond {requestId, answers: {"computer-access": "<label>"}}`; the reactor skips provider routing for that prefix, `ComputerAccess` applies the grant or denial and appends `user-input.resolved`. The tool waits 45 s, then returns pending and the model calls again (Codex times MCP calls out at 60 s).
- Stop: `thread.turn-interrupt-requested` aborts the thread's in-flight Cua calls (cancelled in Cua), refuses every later call of that turn, and ends the thread's Cua session (releases held input, hides the cursor).

### Phase 7: computer UI

Build `apps/web/src/components/computer/`:

- Settings section `ComputerSettings.tsx`: driver status, permissions with "Open System Settings", default mode, current grants with revoke
- Chat: `ComputerAccessCard.tsx` (grant request with `read` / `act` / `full`), `ComputerActionRow` presentation through the existing tool-row classification, `ComputerActivityPreview.tsx` (latest screenshot or window title while a task runs, with Stop)
- Composer: `/computer-use` slash command and hint, thread menu toggle
- Settings navigation and search index entries

Checks: `bun run check`; visual check in the Dev app, light and dark, reduced motion for the preview.

Commits: `feat(web): Computer Use settings, access cards and activity preview`.

Revisions (as built):

- State reaches the web as one WS group in `packages/contracts/src/transport/ws/computerRpc.ts`: `computer.subscribe` streams driver status plus every thread whose mode is not off or that holds grants (`{status, threads: [{threadId, mode, grants}]}`), recomputed when `ThreadComputerUse` or `ComputerGrants` report a change or the driver status moves; `computer.revokeGrant {threadId, app, windowId}` revokes from Settings. Handlers live in `apps/server/src/computer/computerWsHandlers.ts`. The mode is not derivable from orchestration events on the web (`thread.computer-use-set` is not projected and `once` ends in memory), so it travels in this group; the web sets it with the existing `thread.computer-use.set` command. The web keeps only the subscription's latest value (`components/computer/computerUseState.ts`), which the thread menu reads synchronously.
- No default mode for new threads: the server has none, so Settings does not offer one.
- Grants remember the window title they were granted for, so Settings lists `app · "title"`.
- Action results end with `Window: <app> "<title>"` (`windowAction` in `computerCalls.ts`), which names the target for the model, the timeline preview (`Clicked … · TextEdit`) and the composer activity line. Timeline rows use a `computer` tool kind ("used the computer N times", cursor-in-window icon).
- The access request uses the generic question card unchanged: its question already names the app, window and reason, and each option describes its scope. A typed (non-option) answer now settles the card and drops the pending request, so the agent's next request opens a fresh card instead of waiting on a closed one.
- Composer: `/computer` sets `once`; text after it stays in the composer as the task. The thread menu (sidebar context menu) toggles `on`/`off`. One stacked composer row shows the mode with a turn-off button, or, while the running turn has used the computer, the current action and the last app and window a result named, with Stop (the existing turn interrupt; `ComputerAccess` already stops Cua work on `thread.turn-interrupt-requested`). No screenshots: tool events carry no image bytes.
- The slash command is `/computer`, not `/computer-use`: a provider skill named `computer-use` (seen with an installed Claude skill) collides with the built-in, which the composer then hides, so the text went to Claude as a message.
- `/computer` also works in a new chat: the draft is marked `once` on the web (not persisted), and the first send dispatches `thread.computer-use.set` after `thread.create` and before `thread.turn.start`. The provider command reactor handles both events in sequence order, so the session starts with the computer tools listed.
- Settings > Computer Use (desktop only): Cua Driver status and health problems, macOS Accessibility and Screen Recording with Request / Open System Settings (re-read on window focus), the platform's limits elsewhere, and grants with Revoke.

### Phase 8: packaging, CI, docs

- `release-build.yml` and `release.yml`: fetch and verify Cua per target, sign the executable with the app identity on macOS, include it in the bundle outside ASAR; Windows and Linux include the matching artifact; remove Rust and Swift toolchain steps
- `docs/computer-use.md` (one page: architecture, permissions, platform matrix, verification) and `docs/browser-use.md` (one page); update `desktop-runtime.md`, `provider-architecture.md`, `glade-feature-scope.md`, `release.md`, `ci.md`, `workspace-layout.md`, `dependencies.md`, `docs/README.md`
- Keep Cua's MIT license text under `docs/licenses/` as redistribution attribution
- `CHANGELOG.md` under the unreleased version: one line each under New for Browser Use and Computer Use, one line under Removed for the browser vault

Checks: `bun run build:desktop` on macOS; CI green on the branch; `bun run test` once, full.

Commits: `build: fetch the upstream Cua driver at build time`, `docs: Browser Use and Computer Use rewrite`.

### Phase 9: cross-platform pass

- Windows: Browser Use end to end; Cua foreground path; named pipe RPC; executable launch from `resources`
- Linux (X11 and one Wayland compositor): Browser Use end to end; Cua X11 background path; Wayland reports semantic-only in Settings
- Computer Use ships on every platform where the pinned Cua release runs, with whatever delivery that platform allows (background where Cua supports it, foreground otherwise). Settings states the platform's limits; no Glade-side platform gate beyond driver availability.
- Measure: tokens per browser step and per computer step on both providers, panel-hidden screenshot latency, driver startup time. Record in this file.

Commits: `fix(desktop): …` as needed per platform.

## 5. Verification policy

- Run `bun run check` at every phase end, not per edit. Run `bun run build:desktop` in Phases 1, 5 and 8. Run the full `bun run test` once in Phase 8.
- New tests are limited to trust boundaries and contract pins:
  1. Cua pinned-release fixture decoding (Phase 5)
  2. Computer approval gate: ungranted refused, granted allowed, Stop clears (Phase 6)
  3. Browser host RPC authentication: missing or wrong token refused (Phase 2, one case added to the existing gateway transport tests if it fits there)
- Existing gateway transport and HTTP route tests stay and must pass unchanged.
- No tests for snapshot formatting, UI, CDP mapping, tool descriptions or anything verified by the provider acceptance runs.
- Provider acceptance (Phases 3 and 6) is manual, scripted in this file, run on Claude and Codex, and its token numbers are recorded here.

## 6. Risks and mitigations

- **Cua release churn.** Weekly releases with renamed fields. Mitigation: exact pin, fixture test, upgrade as a deliberate commit.
- **Electron single debugger client.** Opening DevTools on a tab detaches automation. Mitigation: listen for `detach`, reattach lazily, and do not expose DevTools on agent-driven tabs.
- **Hidden-pane screenshots.** Chromium stops compositing hidden views. Mitigation: `backgroundThrottling: false` on all browser views; fall back to `webContents.capturePage()` with a timeout.
- **macOS TCC identity.** Grants bind to the signing identity; unsigned Dev builds behave differently. Mitigation: verify grants with the packaged app before release; document it.
- **Wayland.** No raw background input on GNOME or KDE. Mitigation: Settings states the limitation; structured tools still work through AT-SPI; pixel tools escalate to foreground.
- **Codex tool count.** Codex loads the whole tool list. Mitigation: computer tools register only when the thread enables Computer Use; browser tools stay compact with `browser_batch`.

## 7. Decisions taken

- Browser panel docks only; no floating window.
- No credential vault. Sign-in happens in the panel by the user; a password-manager handoff may come later as its own feature, never a Glade-held secret store.
- Element picking returns through CDP inspect mode and the agent's own ref table (Phase 4), replacing the old annotation overlay.
- Loopback stays reachable from the agent browser; only Glade's own ports and the dangerous schemes are blocked (Phase 2 revision, see Approval model).
- Agent browser dialogs are dismissed and reported; `browser_dialog` arms the next answer (Phase 2 revision, see Browser host design).
- The browser panel is a dock beside the chat, not a workspace tab; it hides its native view whenever Glade UI must draw over it (Phase 4).
- Computer Use is available on every platform the pinned Cua release supports, including Windows, with the delivery mode that platform allows.

## 8. Phase 0 findings (2026-10-07, macOS arm64)

- **Pin:** `cua-driver` 0.34.0 (`cua-driver-rs-v0.34.0`), contract 0.8.0, MCP 2025-06-18. Release assets carry `SHA256SUMS` and per-asset digests; the `*-binary` archives contain the bare executable (signed `Developer ID Application: Cua AI, Inc. (YCK386LBJ7)`) plus `libcua_driver_sdk.dylib`. npm `@trycua/cua-driver@0.34.0` is ESM only (`.`, `./embedded`, `./electron`) and installs one optional native package per platform; it does not ship the executable.
- **Embedded host:** `new EmbeddedCuaDriverHost(binaryPath, bundleId)` (or `withOptions`) → `start()` returns `{ socketPath, pid, generation, driverVersion, contractVersion, mcpProtocolVersion, mcp: { command, args, environment[] } }` in ~220 ms. There is no loopback URL or bearer token; the transport section above is corrected accordingly. `stop()` is idempotent; `restart()` changes generation and socket.
- **TCC:** run from the Glade (Dev) bundle launched through LaunchServices, `check_permissions` reports `source.attribution: "host"` and `health_report` confirms `bundle_identity` = `com.agent.glade.dev`. A process spawned from a terminal attributes to the terminal, so Dev verification of Computer Use launches the bundle with `open`. The Screen Recording prompt does not appear on this macOS; the host must open the settings pane (`openMacOSScreenRecordingSettings`) and the user adds the app.
- **Telemetry:** default-on PostHog telemetry; the host sets `DO_NOT_TRACK=1` and `CUA_DRIVER_RS_TELEMETRY_ENABLED=0` in the embedded environment.
- **MCP tools (0.34.0):** `list_apps`, `list_windows`, `get_window_state`, `verify_state`, `launch_app`, `kill_app`, `bring_to_front`, `set_window_frame`, `invoke_menu`, `click`, `double_click`, `right_click`, `drag`, `type_text`, `press_key`, `hotkey`, `set_value`, `scroll`, `clipboard_read`, `clipboard_write`, `get_screen_size`, `get_desktop_state`, `get_cursor_position`, `move_cursor`, agent cursor tools, `check_permissions`, `health_report`, `get_config`, `set_config`, `get_accessibility_tree`, `zoom`, `page`, Cua's own `browser_*` tools, recording/replay, session tools, `check_for_update`, `install_extension`, `parse_visual_regions`. Glade exposes its `computer_*` surface over these and never forwards Cua's `browser_*`, update, extension, recording or config tools.
- **CDP spike:** folded into Phase 2's manual check instead of a throwaway script; `webContents.debugger` + `Accessibility.getFullAXTree` is stable Electron API and the risk is in ref bookkeeping, which Phase 2 builds anyway.
- **Phase 5/6 findings (0.34.0):** tool errors carry `structuredContent.code` (e.g. `background_unavailable`: background scroll does not reach Electron/Chromium windows on macOS); action results carry `effect`/`escalation`; window screenshots are PNG with `screenshot_scale`, zoom is JPEG; standalone `cua-driver mcp` requires CuaDriver.app, so only the embedded path is used.
- **Launcher grant reset:** the dev launcher clears TCC rows whenever the bundle is re-signed. It imports `TCC_SERVICE_NAMES` from the old computer module; Phase 1 keeps that constant (moved next to the launcher's identity code) so teardown does not re-sign the bundle.

## 8a. Phase 2 manual check (2026-10-07, macOS arm64, plain Electron 43.5.0)

A scratch Electron main drove the built modules directly and through the RPC server, then the server `DesktopHostClient` → `BrowserHost` → gateway tool handlers drove a real desktop host with the token on fd 3. All with the view hidden (never attached to a window). Worked: open, navigate, `filter: interactive` and `all` snapshots with OOPIF content, click (also inside a cross-site iframe), type into an MDN search field, `<select>`, key chords, scroll, dialog report and armed accept, upload to a file input and through a button-opened chooser, download into `.glade/downloads`, popup as a tab, console and failed-request reads, viewport (1280×800, ~300–600 ms) and element screenshots, stale-ref, blocked-URL and cross-thread refusals, `browser.tabsChanged` notification.

Snapshot size, `filter: interactive` (chars / 4): example.com ≈ 7 tokens, MDN `<input>` reference ≈ 5,550, Wikipedia "Electron (software framework)" ≈ 4,900 (`filter: all` ≈ 6,000, capped at 24,000 chars). The browser tool list costs ≈ 3,500 tokens in `tools/list`.

Phase 1 had dropped the inherited environment from the backend's spawn environment; Phase 2 restores it (minus stale desktop host variables).

### Browser provider acceptance (2026-10-07, Dev app, macOS)

Same five-step script (open MDN, find and click the "HTML" link, search "input element" through the site's search box, screenshot, read console), browser tools only:

- Codex (GPT-6.1-Sol, medium): all five steps passed in 19 s.
- Claude (Sonnet 5, medium): all five steps passed in 23 s.

Per-step token counts were not read from the usage panel; snapshot sizes are in 8a.

## 8b. Phase 5/6 verification (2026-10-07, macOS arm64, Dev bundle via `open`)

Driver started under the Dev bundle (`accessibility`/`screenRecording` true, no health problems), the server connected its proxy, `kill -9` of the daemon produced a new generation and a reconnect within ~1.2 s, and quitting the app stopped daemon and proxy. The real gateway MCP transport and computer tools, driven from a scratch script against the live daemon: `tools/list` empty while off and 16 tools while on, `computer_use_off` refusal, `computer_apps`, `access_required` for an ungranted window, `computer_window_state` tree after a read grant, act refused under a read grant, zoom JPEG, screenshot PNG at 1279×802. Not exercised live: the desktop JPEG re-encode, the access card round trip in the web, and provider turns (Claude, Codex).

## 9. Open items

- Phase 8: fetch per build target (cross-arch and macOS universal builds also need both darwin native SDK packages installed), and run a signed packaged build to confirm the team-signature check.

- Record token measurements from the provider acceptance runs here.
- Page dialogs in the visible panel: v1 dismisses and reports them. A user-facing answer path would need a non-blocking prompt in the panel.
- Keyboard shortcuts do not reach Glade while focus is inside a page view.
