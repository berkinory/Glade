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

Durable batching preserves the original event rows and live order. Lifecycle events form flush barriers, and shutdown persists and publishes the unfinished batch before the stream closes. Coverage uses the real SQLite journal and durable provider service. A separate atomicity check verifies that an ID conflict rolls back the whole batch.

Terminal startup uses an explicit output-subscription readiness envelope and output sequence numbers for snapshot/live handoff. A real PTY run delayed the snapshot response by 100 ms while fifty numbered lines arrived; every line appeared once and the initial prompt prefix survived. Image support buffers split sequence headers and awaits the image decoder before replaying the first image. The addon patch covers both published module formats and its types.

The terminal timing is one cold Dev sample, not a signed production build measurement. Streaming verification confirms stable completed-line DOM nodes through the final render; an actual pointer-drag text-selection interaction was not separately verified.

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
