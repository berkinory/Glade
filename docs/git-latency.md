# Git latency verification

## Measured change

History combines current-branch/upstream, branch decorations and annotated tag metadata into one bounded `for-each-ref` read. It retains fresh reads and the existing process queue. There are no new caches, longer TTLs, network fetches or mutation changes. Missing upstream evidence still produces unknown publication status.

Twenty samples per action on macOS, Git 2.50.1, warm OS caches, fresh application reads and no network:

| Repository / action                   | Before median / p95 (ms) | After median / p95 (ms) | Git starts before / after |
| ------------------------------------- | ------------------------ | ----------------------- | ------------------------- |
| Large, History open                   | 93.38 / 109.31           | 45.77 / 51.80           | 7 / 3                     |
| Large, next History page              | 130.58 / 226.05          | 45.76 / 51.64           | 7 / 3                     |
| Large, open commit                    | 21.93 / 39.94            | 16.96 / 21.59           | 1 / 1                     |
| Large, parse commit patch             | 0.34 / 1.41              | 0.11 / 0.27             | 0 / 0                     |
| Large, History with concurrent status | 91.30 / 100.76           | 53.00 / 176.74          | 9.4 / 5.4                 |
| Small, History open                   | 136.13 / 178.17          | 22.88 / 24.82           | 5 / 2                     |
| Small, next History page              | 69.54 / 74.02            | 23.15 / 25.75           | 5 / 2                     |

The large fixture is a local clone with 3,736 tracked files and 4,041 commits, a remote upstream and a clean working tree. The small fixture has one tracked 1,000-line file, 45 commits, no upstream and a clean working tree. Both paths contain spaces and non-ASCII characters. Other development builds/checks ran concurrently, so absolute timing and the concurrent-status tail are noisy. The reduced command count is deterministic; unchanged commit/parse timings are controls, not claimed improvements.

Mutation controls were repeated after moving Trace2 output outside the disposable Git repository. Twenty samples with one changed target file:

| Action                   | Current median / p95 (ms) | Git starts |
| ------------------------ | ------------------------- | ---------- |
| Stage file               | 8.87 / 9.89               | 1          |
| Unstage file             | 16.16 / 17.40             | 2          |
| Selective stash          | 29.14 / 30.84             | 5          |
| Stash restore            | 15.87 / 16.73             | 2          |
| Working-tree discard     | 17.69 / 18.11             | 2          |
| Commit                   | 26.83 / 28.71             | 3          |
| Committed-history revert | 16.22 / 16.72             | 1          |

These mutation paths did not change. Earlier before/after mutation measurements included a tracked diagnostic trace file and concurrent machine load; they are excluded from performance claims. Verification compares restored stash text, discarded text and committed/index/working-tree contents. Revert creates another commit; discard restores an unstaged file. Neither measurement implements Undo commit.

## Repeatable procedure

Run from the same checkout before and after the change:

```sh
bun run --cwd apps/server measure:git-latency '/path/to/repository with ü spaces' 20 > git-latency.jsonl
```

The supplied repository is read only. The script creates and cleans its own disposable mutation repository and isolated server home. Each JSON record contains first sample, median, p95, Trace2 Git starts, Git elapsed time and serialized service-response bytes. Trace2 includes nested Git children; summed child durations overlap parent durations and are not an additive wall-clock breakdown. The first sample follows setup reads and is not a cold-cache sample. Run on a quiet machine, repeat with concurrent working-file edits/status reads, and retain the repository metadata record with results.

For native Windows, use the installed Bun and Git with a local NTFS fixture path containing spaces and non-ASCII characters. Repeat small/large fixtures with the same commits and changes. For WSL, run the script inside the supported distro against the equivalent Linux fixture. That measures Linux Git/service execution, not the Windows-to-WSL bridge. Separately open the supported UNC workspace in the real Windows Dev desktop app to exercise that bridge, executable resolution, watcher behavior and process cancellation. Follow [Windows runtime](windows-runtime.md) without introducing a shell wrapper.

For desktop measurements, launch an isolated home and unused ports through the real dev runner after inspecting its dry-run output. Record click-to-visible-result timings for History, next page, commit open and file expansion; repeat stage/unstage, stash/restore, discard and commit with concurrent edits. Record RPC request/response and refetch counts in DevTools, response sizes and render/parse traces. Compare index and file contents after every mutation. Repeat after restart and with cold caches, hooks and network-enabled operations separately.

The script measures service wall time and Git Trace2 execution, response size and patch parsing. RPC admission, queue wait, executable startup, invalidation/refetch and browser rendering are not individually instrumented here. No complete click-to-render latency, cold-OS-cache result, hook/network cost or Windows/Linux desktop speedup is claimed. Windows and WSL execution were unavailable on the macOS measurement host.

## Change verification

The affected SQLite attribution, GitCore and process-queue suites passed 20 tests. Typecheck, typed lint, desktop build and the Windows process-boundary check passed. The required global check remains blocked by formatting and unused exports in concurrently edited handoff code. Full test attempts failed existing web RPC-call expectations and markdown timeouts; a separate full server attempt was interrupted after making no completed-suite progress. This is not a passing full-suite result. Dev verification exercised small-repository History, commit open and file expansion. Activity rendered preserved 800-token archive totals, known/unknown groups and the turn fallback after restart. New live provider turns and the full Git mutation UI matrix remain unverified.
