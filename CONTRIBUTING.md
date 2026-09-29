# Contributing to Glade

This guide covers proposing changes, running checks, and opening pull requests.

## Before you start

- Search existing issues and pull requests to avoid duplicate work.
- For a small fix, open a pull request directly. For a larger feature or change
  in product direction, open an issue first so we can agree on scope.
- Report suspected vulnerabilities privately through the process in
  [SECURITY.md](SECURITY.md). Do not include secrets or exploit details in a
  public issue or pull request.

## Develop locally

Use the Bun version in `.mise.toml` for development, then install dependencies. The pinned Node version is for builds and releases:

```sh
bun install --frozen-lockfile
bun run dev
```

Run `bun run dev:stop` to stop all local Glade development processes. Add `--dry-run` to preview
which process trees it would stop.

Keep changes focused and preserve unrelated work. Follow the existing code
conventions, update documentation when behavior changes, and include tests only
when they protect important behavior that is not already covered.

For code changes, run the static checks before opening a pull request:

```sh
bun run check
```

`check` rejects lint warnings, unused code reported by knip, source dependency
violations and import cycles, including type-only cycles. `check:architecture`
runs the dependency checks separately. `check:typed-lint` adds type-aware checks
for floating/misused promises, invalid awaits and dynamic evaluation. This is a
separate focused lane; the primary lint invocation enforces all configured
syntax categories first. CI runs typed lint after installing every workspace.
Effect language-service diagnostics use the
shared base configuration in every package. Editor suggestions stay in the editor;
compiler checks enforce the configured diagnostics. Only SDK transport boundaries
that necessarily accept opaque errors may bypass a diagnostic, with a reason.

Use `bun run check:fix` to apply formatting and safe lint fixes, then review the resulting diff.
Run the affected tests. Use `bun run test` for cross-package and lifecycle
changes. Describe any relevant checks you did not run. Check UI changes in the
running app; include before/after screenshots when they help reviewers, and a
short recording for motion or interaction changes.

## Open a pull request

Target the `main` branch. Explain the problem, the change, and how you verified
it. Link a related issue if there is one. Maintainers review contributions on
their merits and may ask for a smaller scope or a different approach.

Glade is licensed under [MIT](LICENSE). Keep existing copyright and license
notices intact.
