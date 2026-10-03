# Dependency maintenance

## Effect runtime

The workspace uses the published npm `4.0.0-beta.25` releases of `effect`,
`@effect/platform-node`, `@effect/sql-sqlite-bun`, and `@effect/vitest`.
`@effect/platform-node-shared` is overridden to exactly `4.0.0-beta.25`: its
parent's caret range otherwise selects the RC series and installs a second,
incompatible Effect runtime.

The preview build previously used by Glade reports the same beta version. A
comparison of its `dist` files with the published packages found:

- Platform Node and Vitest executable JavaScript is identical.
- Schema and SQLite migrator differences are comments only.
- The published SQL resolver wraps transaction connections by reference and
  yields its tagged length-mismatch error directly. Glade does not use
  `SqlResolver`; there is no unpublished preview fix to carry forward.
- Platform Node Shared differs only by Glade's existing process-spawner patch.

The process-spawner patch is retained against the published package. It rejects
unsafe process IDs before signaling a group and forwards `windowsHide` and
`windowsVerbatimArguments` to Node's child-process API. Removing it would change
process safety and Windows launch behavior. Its source and executable output
are both patched.

Keep all five Effect packages on the same exact beta when revisiting this pin.
Compare executable output before changing the version, then run the workspace
checks, tests, desktop build, Windows runtime boundary and migration lineage
checks. A successful local build does not verify a signed release.

## Overrides

The original override set was checked against a fresh resolution. Axios, defu,
fast-uri, follow-redirects, form-data, Hono, Joi, lodash, PostCSS, qs, UUID, Vite,
ws and YAML now resolve naturally at or above their former security floors.
The protobufjs override had no remaining consumer. Knip brings back smol-toml
with a range above the old floor, so its override is also unnecessary.

`ip-address >=10.7.1` remains forced because express-rate-limit pins `10.1.0`.
It covers the upstream [address-family allowlist bypass](https://github.com/beaugunderson/ip-address/security/advisories/GHSA-j6r3-76f7-8jcv)
and [unbounded IPv6 parse diagnostic](https://github.com/beaugunderson/ip-address/security/advisories/GHSA-h3mg-xc3c-68pw),
as well as earlier classification and HTML escaping fixes. The installed
version is `10.7.2`. The Effect override above prevents version skew rather
than addressing a security advisory.

`toml` is pinned and overridden to `4.2.0` so both Codex configuration parsing
and Effect use the fixes for
[prototype pollution](https://github.com/BinaryMuse/toml-node/security/advisories/GHSA-v5mp-jgw5-2x6j)
and [unbounded parser recursion](https://github.com/BinaryMuse/toml-node/security/advisories/GHSA-82x6-q7mm-w9cf).
Electron is pinned to `43.5.0`, which fixes
[sandboxed preload cache poisoning](https://github.com/electron/electron/security/advisories/GHSA-qmv3-fv6v-rmhq)
when displaying untrusted content.

## Patches

- **BetterWright 2.7.3:** removed. It only modified cookie import for host-owned
  sessions; Glade has no runtime caller of that retired feature. There is no
  reason to carry its upstream customization into browser automation.
- **Legend List 3.3.3:** retained. A deferred end-follow frame must recheck that
  following is still enabled, and visible-content anchoring must include the
  partially visible row. The installed release still lacks both changes.
  The related upstream tracking issue is
  [LegendApp/legend-list#492](https://github.com/LegendApp/legend-list/issues/492);
  it is not an exact patch acceptance or release guarantee.
- **Pierre Diffs 1.3.5:** retained. Structural file edits must publish cached rows
  to the DOM and dirty the selection. The installed release still lacks the
  rerender calls. Related upstream work includes
  [pierrecomputer/pierre#1029](https://github.com/pierrecomputer/pierre/pull/1029)
  and [#1072](https://github.com/pierrecomputer/pierre/pull/1072); a merged PR is
  not evidence that this installed artifact contains the fix.
- **Effect Platform Node Shared beta.25:** retained. The installed beta lacks
  the Windows options and unsafe-PID guard described above. Related Windows
  work is [Effect-TS/effect#7154](https://github.com/Effect-TS/effect/pull/7154),
  merged after this beta. No matching upstream unsafe-PID PR was found during
  the audit. Remove the patch only after comparing the replacement artifact.

## Terminal image decoder

`@xterm/addon-image@0.9.0` registers its sixel handler before the WASM decoder
is ready. Lazy activation can therefore silently discard the first image. The
patch exposes `ImageAddon.ready` after activation; Glade holds the first image
chunk until that promise resolves. Source, both executable bundles and typings
are patched. Remove this patch when upstream exposes equivalent readiness.

## Dot Matrix indicators

The web client adapts Mobius Run, Prism Sweep, Core Spiral, Flux Columns and Sound
Bars from [Dot Matrix](https://dotmatrix.zzzzshawn.cloud/). The shared SVG renderer
uses precomputed opacity frames instead of the gallery runtime, with no glow and
subtle background dots. Skeleton placeholders retain their existing behavior.

The source is covered by a custom license permitting use within products, rather
than MIT. Its license is retained in
[LICENSE.dotmatrix.txt](../apps/web/src/components/ui/spinner/LICENSE.dotmatrix.txt).
