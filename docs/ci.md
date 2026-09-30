# CI and release automation

## Workflow ownership

| Workflow                   | Trigger                                                       | Responsibility                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                   | Every PR and push to `main`                                   | Static checks, immutable migration lineage, full Linux unit suite, desktop build and Electron lifecycle, relevant Windows process checks, final status gate |
| `cua-native-check.yml`     | macOS computer runtime, dependencies or native inputs; manual | macOS host/lifecycle checks; native compilation only for native inputs or manual runs                                                                       |
| `cua-linux-check.yml`      | Native source descriptor, patches or native setup; manual     | Patched Linux driver compilation and Rust regressions                                                                                                       |
| `cua-release-cache.yml`    | Native release inputs on `main`; weekly; manual               | Produce and retain verified unsigned native artifacts for release                                                                                           |
| `device-helper-matrix.yml` | Weekly; manual                                                | Probe six Xcode/image pairs and run simulator smoke when a runtime exists                                                                                   |
| `release.yml`              | Version tags; manual                                          | Verify source and publication credentials, require exact-commit main CI, orchestrate four builds, assemble and publish verified artifacts                   |
| `release-build.yml`        | Called by release                                             | Build, verify startup and provenance, upload one platform's distribution assets                                                                             |
| `sync-homebrew.yml`        | Called after publication; manual                              | Dispatch the tap update and verify its version and architecture checksums                                                                                   |

CI always reports `Format, Lint, Typecheck, Test, Browser Test, Build`. Documentation-only changes
still run formatting, lint, workflow lint, the Windows boundary checker and migration lineage.
Heavy lanes skip only when the change filter succeeds and reports no code. The gate rejects failed,
cancelled or unexpectedly skipped lanes, and prints the lane results in the run summary.

Windows checks cover changes under server, desktop, packages, scripts, dependency patches,
shared root configuration, manifests, lockfile and workspace setup. Web-only changes skip Windows.
Core and web suites run sequentially on one runner; all three server shards remain parallel.
Independent static checks and the web suite still report when an earlier check fails.
Linux Cua host/protocol tests belong to the complete CI unit suite, so the native workflow does not
install the JavaScript workspace and run those same suites a second time.

Main CI keeps its complete checks: releases require its result for the exact source commit, and
direct pushes must remain checked. Publication and an unpublished manual build have different gates:
publication reuses main CI, while an unpublished build runs checks itself. Release concurrency never
cancels active publication. See [release instructions](release.md).

## Cache ownership

`setup-node` reads and validates the exact Node version in `.mise.toml`, rather than resolving
the compatible range in `package.json`.

`setup-workspace` always performs a frozen-lockfile install, even on a cache hit. Cache contents
accelerate installation; they never replace dependency validation or check execution.

- Linux CI typecheck and macOS Cua runtime are the dependency cache producers, only on pushes to
  `main`. Matrix jobs, PRs and releases restore without saving. Windows and filtered static installs
  use cold installs; Windows keeps Bun's package cache on the workspace volume.
- Dependency keys include OS, architecture, lockfile, workspace manifests, toolchain pins, patches
  and setup action. Dependencies are saved before downloading Electron or generating build outputs.
  The redundant full Bun package archive and Electron-specific dependency trees are gone.
- Main CI desktop build owns the Electron download cache and Turbo output cache. Releases may reuse
  those outputs on a matching OS/architecture. Other architectures build cold until a compatible
  producer exists; no cross-platform native cache reuse is allowed.
- Tests and typechecks remain uncached. Setup prints exact-hit information in each job's summary.
- `prepare-cua-source` sparsely checks out only `libs/cua-driver`, verifies pinned source and patches
  and restores check-only Cargo dependencies.
  Its cache includes compiler, image, native input and SDK selection boundaries, and only main pushes
  save it. It does not produce binaries for release.
- `provision-cua` retains exact compiler/SDK fingerprints, binary checksums, source provenance and
  trusted producer checks. Release Cua caches and retained artifacts remain separate from Cargo caches.

Third-party actions are pinned to full commit SHAs. Dependabot groups weekly GitHub Actions updates.
CI downloads actionlint 1.7.12 with a fixed SHA-256 checksum; changing the version requires changing
its checksum too. Workflow changes must pass `actionlint` locally before opening a PR.

## Debugging

Start with the failed lane, then its named step. The aggregate gate shows every result and the code
and Windows filter decisions. Setup summaries distinguish an exact cache hit from a miss or an unused
cache. Native provisioning reports the exact cache key and persistent artifact run. Device probes
upload their capability JSON even on failure; toolchain inventory runs inside the probe jobs.

For release failures, distinguish source/credential/CI gating, platform packaging, startup,
provenance, assembly and Homebrew. Platform steps live in `release-build.yml`; its caller keeps the
matrix and publication decisions. A failed platform never reaches publication. macOS signing and
notarization, packaged startup, architecture checksums and provenance verification remain required.

## Audit baseline: 2026-09-30

Measured with the requested [optimise-github-actions skill](https://github.com/enesgules/dotfiles/blob/main/skills/optimise-github-actions/SKILL.md)
and its `scripts/measure.mjs`, over the preceding 14 days: 46 runs, 292 executed jobs.
The repository is public, so standard hosted runner usage is free. The skill's figures below are
Linux-minute equivalents using its rounding and platform multipliers, not an invoice.

| Area                          | Equivalent minutes | Share |
| ----------------------------- | -----------------: | ----: |
| Release push                  |              2,512 | 63.2% |
| Device helper schedule        |                440 | 11.1% |
| Cua release cache, all events |                407 | 10.2% |
| CI, push and PR               |                310 |  7.8% |
| macOS Cua checks              |                280 |  7.0% |
| Linux Cua checks              |                 20 |  0.5% |
| Homebrew and dependency bots  |                  5 |  0.1% |

Total: 3,974 equivalents, projected 8,516 per month at that cadence. Rounding adds 352 (8.9%);
cancelled jobs account for 92 and failed jobs for 372. Successful main CI median/p90: 2.5/4.6 minutes;
release median/p90: 22.6/23.0 minutes. Historical totals include the already-retired universal macOS
release job; removing it is not a saving from this revision.

| Change                                                         | Evidence and expected benefit                                                                                                                                                                                   | Tradeoff                                                                                                       |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Release cache consumers never upload dependency/build archives | [Sample release](https://github.com/berkinory/Glade/actions/runs/36575012575): Intel macOS post-setup took 218 seconds, arm64 68 seconds; removing exports offers about 3.6 minutes on that Intel critical path | First v3 installs/builds are cold; actual net improvement requires a new hosted run                            |
| Core/web share setup; lineage joins fast static checks         | [Sample CI](https://github.com/berkinory/Glade/actions/runs/36638530099): separate core/web setup took 32/28 seconds, lineage executed in under a second                                                        | Saves two runner starts per code run; sequential core/web work must remain below the build/shard critical path |
| Windows selection follows its actual input trees               | Two code-only comparisons out of eleven complete main comparison lists would skip Windows; two additional API lists were truncated and excluded from the estimate                                               | Broad shared/server inputs deliberately still run Windows; comparisons approximate push ranges                 |
| Linux Cua stops repeating JavaScript setup/tests               | [Sample Linux run](https://github.com/berkinory/Glade/actions/runs/36638530317): setup 27 seconds, duplicate suites 25 seconds, post-setup 10 seconds                                                           | Those suites remain in CI, rather than appearing twice in separate workflows                                   |
| Native-only macOS compilation and Cargo caching                | [Sample macOS run](https://github.com/berkinory/Glade/actions/runs/36638530003): compile 103 seconds, Rust regressions 167 seconds                                                                              | Warm-cache improvement is unmeasured; new runtime input filters also close coverage gaps                       |
| Device inventory uses existing probe runners                   | Three inventory-only macOS jobs previously used 30 equivalent rounded minutes per weekly run                                                                                                                    | Inventory remains visible in each probe; added seconds can affect probe rounding                               |

No draft skipping, merge-queue conversion, self-hosted migration or reduced main validation was
introduced. The observed PR churn was too small to justify draft policy changes; rulesets were empty
and `main` had no branch protection at audit time. Hosted timing and cache-size comparisons after the
first warm run are the acceptance evidence for speed improvements, not local test duration.
