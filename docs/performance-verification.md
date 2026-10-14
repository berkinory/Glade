# Performance verification

The implementation assigned by `PERFORMANCE.md` covers all thirteen parts. These measurements use isolated fixtures and homes on the maintainer's macOS development machine. They describe the tested workloads, not production guarantees. The user's provider home and application database were not modified.

| Parts | Workload                                                                      | Before                                                                           | After                                                                                                      |
| ----- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1, 4  | Twenty warm worktree refreshes using full status versus sidebar summaries     | 60 Git processes, 20 numstat calls, 2,094 ms                                     | 20 Git processes, no numstat or fetch, 534 ms                                                              |
| 2     | Three warm full Git statuses                                                  | 36 processes, 903 ms                                                             | 9 processes, 692 ms                                                                                        |
| 3     | Twenty-four simultaneous Git reads                                            | Independent subprocess fanout                                                    | Peak concurrency of six; identical HEAD reads share one process                                            |
| 5     | Five native Codex threads, each with a configured stdio MCP server            | Five app-servers, 499,392 KiB combined app-server RSS                            | One app-server, 108,640 KiB app-server RSS                                                                 |
| 6     | One thousand durable streaming deltas in an isolated SQLite file              | 1,000 transactions, 185 ms, 2,266,032 bytes of WAL                               | Ten transactions, 25 ms, 1,087,712 bytes of WAL; all original rows retained                                |
| 7     | Twenty thousand 1 KiB buffer allocations                                      | 20 GB cumulative allocation, 247 ms                                              | 20.5 MB cumulative allocation, 3 ms                                                                        |
| 8, 9  | Explorer with 5,000 files; source control with 1,000 changes                  | All rows mounted                                                                 | About 40 explorer rows and 35 change rows mounted                                                          |
| 9     | Diff with 1,000 files                                                         | 1,000 expensive file cards                                                       | Ten expensive file cards; all file jump targets retained                                                   |
| 10    | One hundred highlighting updates of a 1,000-line code block                   | 3,182 ms                                                                         | 55 ms                                                                                                      |
| 10    | One hundred markdown parses with a stable closed fence prefix                 | 326 ms                                                                           | 25 ms                                                                                                      |
| 10    | Live 4,000-line code block followed by 1,000 streamed lines                   | 94 long tasks, 29,268 ms cumulative long-task time; first line replaced 38 times | 64 long tasks, 18,897 ms cumulative long-task time; first line retained through completion                 |
| 11    | First open of the 1,000-file diff, measured across two animation frames       | 535 ms                                                                           | 294 ms                                                                                                     |
| 11    | Close and reopen the diff on a ten-core machine                               | Five replacement workers                                                         | The existing five workers reused                                                                           |
| 12    | Cold Dev terminal launch with a real zsh prompt                               | 1,297 ms                                                                         | 141 ms with idle preload and parallel PTY startup                                                          |
| 13    | Plain terminal output, followed by first split Sixel and inline PNG sequences | Image addon activated for every terminal with a 128 MB allowance                 | No addon for plain output; one activation on image output with a 16 MB allowance; both first images stored |

The Git baseline and summary comparison explicitly exclude remote fetching. Native repository watchers delivered a branch change in 224 ms in the fixture and released their resources when the subscription closed. Full status retains line counts; the sidebar does not request them. Working-file diff polling remains because `.git` watchers do not observe every working-file edit. Slow safety polling remains for repository status and remote state.

Explorer prefetch now requires pointer intent, skips unsupported text grammars, rejects incomplete or oversized previews before reading their contents, and expires unviewed preview data. Browser verification covered large-list rendering, keyboard movement to the last explorer entry, diff jumps to the last file, and terminal output. Browser heap retention was not measured; mounted-row counts are not heap measurements.

## Native Codex boundary

The five-thread measurement uses the installed Codex 0.158.0 CLI, actual stdio MCP children, and local HTTP servers for Responses and MCP. The local Responses fixture only completes a short reply; it does not establish live model quality or remote-provider behavior. A second run exercises the production CodexAppServerManager with five native threads, actual completed turns, and one shared app-server. Stopping and resuming one thread preserves the other four sessions. The MCP fixture returns the actual HTTP Authorization header it receives. Five thread credentials stayed separate; resuming one persisted thread changed its credential without changing another thread's credential.

MCP child processes remain native thread resources. Their count was five in both runs, with combined RSS of 239,136 KiB before and 238,336 KiB after. The plan's claim that app-server sharing starts every MCP server only once is therefore not supported by native Codex and is deliberately absent from the changelog. Unsubscribing a thread also does not immediately unload its native context; the shared process is terminated after its final Glade lease retires.

Critical coverage verifies unique request IDs, thread notification and approval ownership, rejection of attaching one native thread to two Glade owners, credential renewal, shared crash recovery, restart backoff, cancellation during startup, and final process-tree exit proof. Stopping one thread does not tear down the remaining threads' process. Failed cancellation invalidates the shared process rather than silently leaving native commands running.

## Persistence and terminal boundaries

Durable batching preserves live order. Within a batch, consecutive assistant text deltas of one message are joined into a single journal row when no other event of the same thread lies between them; every other event keeps its own row. Lifecycle events form flush barriers, and shutdown persists and publishes the unfinished batch before the stream closes. Coverage uses the real SQLite journal and durable provider service. A separate atomicity check verifies that an ID conflict rolls back the whole batch.

Terminal startup uses an explicit output-subscription readiness envelope and output sequence numbers for snapshot/live handoff. A real PTY run delayed the snapshot response by 100 ms while fifty numbered lines arrived; every line appeared once and the initial prompt prefix survived. Image support buffers split sequence headers and awaits the image decoder before replaying the first image. The addon patch covers both published module formats and its types.

The terminal timing is one cold Dev sample, not a signed production build measurement. Streaming verification confirms stable completed-line DOM nodes through the final render; an actual pointer-drag text-selection interaction was not separately verified.

## Coalesced assistant text (October 2026)

A synthetic turn through the durable provider service, journal, ingestion and engine on a file-backed SQLite database streamed 400 assistant text deltas in bursts of five or six every 50 ms (the burst shape of the audited database), across three text segments separated by ten tool calls. Coalescing in the 100 ms journal batch reduced journal rows from 423 to about 60, orchestration events, command receipts and thread stream pushes from 424 to about 61, and database growth from about 627 KB to 74 KB. Process CPU time per turn was between 650 and 985 ms before and between 283 and 381 ms after, over three runs each. The final text and segments were identical, and first-delta latency stayed within the existing batch tick. On the audited database the same 100 ms window would have written about 2,100 rows for its 18,070 streamed deltas.

## Repository checks

The required checks are `bun run check`, `bun run test`, `bun scripts/check-windows-runtime-boundary.ts`, and `bun run build:desktop`. Focused Codex, journal, Git, transport, workspace and markdown checks were also run during implementation. The final run passed all checks and all 2,570 tests (nine tests skipped by their existing platform or live-provider conditions). The Windows boundary check covered 596 application source files, and the desktop build completed successfully. Exact outcomes are also recorded in the implementation commits. Existing large-chunk build warnings are not performance measurements.

## Chat shell and settings (October 2026)

An isolated Bun fixture compared the previous and current work-log derivation on 1,500
immutable completed tool activities, with five warmups and 50 derivations. Total time
was 521.81 ms before and 12.34 ms after. Serialized results matched; replacing an
activity immediately changed its displayed label. This measures normalization and
reconciliation, not browser frame rate or provider latency.

One hundred reads of the same storage key/raw value/schema reused the same decoded
object (including frozen nested values). Replacing the stored value was immediately
visible. App settings reuse normalization for the same immutable local/server pair.
The shell selects metadata and counts rather than transcript payloads, and the
artificial route-switch animation-frame readiness gate has been removed. Focus still
requires an available, enabled editor and a focused document. Committed route matches
supply pathname, parameters and search together during navigation.

Browser frame timings, cross-window events and cancelled navigation still need live
verification. Existing missing Browser shell/icon imports prevent a clean full web
typecheck; they are unrelated to these measurements.

## Running chats, desktop uptime and cold start (October 2026)

These measurements use a copy of a real 380 MB database (91 threads, 37,485 activities, 91,195
events) in an isolated home on an Apple silicon MacBook. The user's database and provider homes
were not modified.

**Live work indicators.** While a turn ran, every spinner animated SVG attributes through SMIL,
which made Chromium restyle, lay out and repaint the whole document every frame. Stepped CSS timing
did not help the work-label sweep, because Chromium services a running animation every frame. In
headless Chrome at 2x scale during a live Codex turn, the page did 61 layouts and 120 style
recalculations a second, with 5.6-6.6% main-thread task time; afterwards it did 1 layout and 11-17
recalculations a second, with 1.0-1.4%. In the Electron Dev app with one injected element each:

| Element         | Renderer CPU before | Renderer CPU after | GPU CPU (both) |
| --------------- | ------------------- | ------------------ | -------------- |
| Working spinner | 7.0-8.1%            | 2.0%               | 5.5-5.8%       |
| Work label      | 4.0-7.1%            | 1.5-1.7%           | 2.5-2.8%       |
| Both            | 8.9-9.1%            | 2.8-3.0%           | 5.8-6.3%       |

Spinners now animate only transform and opacity on whole layers, so the compositor runs them; the
GPU still composites each frame of a smooth spinner. The label sweep keeps its 30 steps per 2.4
seconds through one shared timer. Rendered frames of all five spinner variants were compared with
the previous ones. The action arc's growing length is split at half a turn across two clipped
semicircles; rendered at the same timestamps as the old stroke-dash animation, fewer than 0.06% of
pixels differed at 96 px, and alone it needs no style or layout work where the old arc needed 60
layouts and 120 style recalculations a second.

**Desktop main process.** The embedded Cua SDK's `waitForExit` polled its Rust future about 18
times a second, and every poll left a libuv async handle behind. In a standalone Node process, one
cross-thread wakeup cost 10 µs before any call, 149 µs after 20,000 calls and 3,750 µs after 60,000
calls, with RSS growing from 34 to 271 MB. The Dev app's main process reached 6.0-6.8% CPU after 29
minutes; the installed 0.2.6 app measured 21.8-23.2% CPU and 399-515 MB RSS after 2h11m-2h35m.
Watching the synchronous connection state instead, the Dev main process stayed at 0.1% CPU and
163-166 MB RSS through 29 minutes, made no further `waitForExit` polls, and still noticed a
killed driver within a second.

**Cold start.** The background-work query in every shell snapshot read 5,631 scattered activity
rows to keep 313. With a cold page cache it took 426 ms in the SQLite shell and 628 ms inside the
server, before the server reported ready. A partial index on the task kinds brings it to 53 ms and
90 ms; warm it takes 5 ms instead of 8 ms, with identical results. Server start to ready on the
copied database, three interleaved rounds:

| Page cache | Before         | After      |
| ---------- | -------------- | ---------- |
| Cold       | 1,173-1,203 ms | 681-713 ms |
| Warm       | 523-594 ms     | 508-569 ms |

The desktop now gives the backend Node's compile cache. Under Electron's Node 24, warm server
start fell from 415-447 ms to 365-401 ms once the cache was filled; the cache is written on a
normal exit (5.2 MB). This was verified with the source build, not a packaged one.

**Measured without changes.** Thread switches took 32-91 ms on revisits; the first open of the
largest thread took about 240 ms, mostly server snapshot work and one 97 ms render. Wheel scrolling
through that thread kept at least 85% of the viewport covered by rendered rows on every frame. A
fresh server's first page load was the same with and without Claude usage scanning. The installed
app's log shows about 230 ms between bootstrap and backend spawn that the source build does not
reproduce (6 ms); packaged startup was not profiled.

## First chat list, usage scan and long-thread opens (October 2026)

These runs use a newer copy of the same real database (400 MB, 38,982 activities) and the same
isolated setup.

**Connecting to a starting server.** The desktop window loads before its backend listens, and the
transport retried a failed first connection on its outage schedule (500 ms, then 1, 2 and 4
seconds). With the page loaded first and the server started 0-1.5 seconds later, the chat list
appeared 135-1,752 ms after the server reported ready. Retrying every 100 ms until the first open
brought that to 66-147 ms.

**Claude usage scan.** The first usage refresh after startup parsed 30 days of Claude transcripts
(255 MB here) on the server's event loop, and a chat opened during it took 628-775 ms instead of
about 340 ms. Skipping lines without a usage key, finding newlines natively, continuing grown
transcripts from the previous scan and parsing two files at a time took the cold scan from 613-622
ms to 302 ms of CPU, and a chat opened during it took 335-357 ms. Results matched the previous
reader on real transcripts and on synthetic appends, duplicates, a partial last line and a rewrite.

**Opening a long thread.** The first open after a restart of a thread with 10,967 activities spent
372-463 ms ranking and reading every activity row and 103-145 ms reading message-sent payloads.
With the covering rank and message-reference indexes and the windowed query, the same queries took
158-162 ms and 41 ms, the end-to-end open went from 875-893 ms to 510-541 ms, and the returned rows
were identical. Building the indexes took about two seconds once.

**Measured without changes.** Another chat streaming in the background raised a tab showing the long
thread from 0.6% to 1.4% main-thread time with no long tasks. Opening seven threads grew the page's
JS heap from 27 MB to 46 MB, and no workers started at boot. Starting the installed server from
`app.asar` took 515-522 ms against 472-516 ms from extracted files.
