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
