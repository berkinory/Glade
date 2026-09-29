# Quickstart

This guide takes you through Glade's basic loop: open a repository, give one coding agent a
concrete task, supervise the work, and review the resulting diff. You should be up and running in
about five minutes.

> **Before you begin:** install Glade and authenticate at least one supported provider. In
> shortcuts, `mod` means Command on macOS and Ctrl on Windows or Linux.

## 1. Add a Git project

Open Glade and add a local repository.

Start with a repository whose current changes are already committed or intentionally preserved. A
clean starting state makes the agent's work much easier to review.

## 2. Create one task

Press `mod+n` or use the new-task control.

For this first task, use the local checkout and run only one agent against the repository. Use a
[Git worktree](./core-concepts.md) when you begin running multiple
tasks or want stronger isolation.

## 3. Choose a provider and model

Select an available provider, model, and effort or reasoning option.

Glade uses the provider runtime and account configured on your machine. It does not add a separate
Glade model plan.

## 4. Give the agent a verifiable objective

Describe:

- The outcome you want
- The files or area involved
- Important constraints
- The checks that should pass

For example:

```text
Add an empty state to the pull-request list.

Reuse the existing shared panel components.
Do not redesign the surrounding page.
Run the relevant existing checks and report the result.
```

A bounded objective is easier to execute, review, and undo than "improve the pull-request page."

## 5. Supervise the turn

Follow the transcript and tool activity while the provider works.

Useful controls:

- `mod+j` opens the terminal in the right sidebar.
- `mod+d` opens the diff view.
- `mod+shift+b` opens the browser.
- Approval and user-input requests appear in the task.
- Send a follow-up when the agent needs a correction or additional constraint.
- Interrupt the turn when it is clearly heading in the wrong direction.

Do not wait passively for a final message if the intermediate work is already incorrect.

## 6. Verify the result yourself

When the turn finishes:

1. Read the agent's summary.
2. Inspect the complete diff.
3. Run the relevant tests or checks yourself.
4. Look for unrelated files, debug output, generated artifacts, or accidental deletions.
5. Keep only the changes you understand and intend to ship.

The agent's final message is a report, not proof that the work is correct.

## 7. Commit or continue to a pull request

Commit the reviewed changes when they are ready.

For GitHub repositories, push the branch, inspect the final change set, and open a PR.

That is Glade's core workflow:

> Give one task a concrete objective, supervise the work, verify the result, and commit only what
> you intend to keep.

## Continue learning

- [Core concepts](./core-concepts.md) — projects, tasks,
  environments, provider sessions, and Git ownership.
- [Provider setup](./providers.md) — installation,
  authentication, capabilities, and troubleshooting.
- [Contributing](../CONTRIBUTING.md) — how to propose
  changes and verify them.

## Run from source

Use the Bun version in [`.mise.toml`](../.mise.toml) for development. The pinned Node version is for builds and releases. From the repository root:

```bash
bun install --frozen-lockfile
bun run dev
```

`bun run dev` builds the current backend, then starts the desktop app with backend and UI watchers.
To run an isolated desktop instance, use
`GLADE_DEV_INSTANCE=feature-xyz bun run dev`. For the browser and server development stack without
the desktop shell, use `bun scripts/dev-runner.ts dev`.
Run `bun run dev:stop` to stop every Glade development app, watcher, and server on this machine.
Use `bun run dev:stop --dry-run` to list the process trees it would stop.

For a production-style local server run, use `bun run build` followed by `bun run start`. The
platform packaging commands are `bun run package:mac:arm64` and `bun run package:mac:x64` (architecture-specific macOS DMGs and update ZIPs),
`bun run package:linux` (AppImage), and `bun run package:win` (NSIS installer).
Glade does not publish an npm CLI; `@glade/cli` is an internal package.

For signing, release packaging, and updates, see the [release guide](./release.md).
