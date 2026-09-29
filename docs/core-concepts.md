# Core concepts

Glade becomes much easier to use once its ownership model is clear: **each task owns one body of
work** — its conversation, provider session, working environment, tool activity, and Git changes.

## The hierarchy

| Concept          | Meaning                                                             |
| ---------------- | ------------------------------------------------------------------- |
| Workspace        | The complete Glade application and the projects available in it     |
| Project          | A local folder, preferably a Git repository                         |
| Task             | One durable unit of work inside a project                           |
| Goal             | An explicit persistent objective attached to one task               |
| Turn             | One user instruction followed by the provider's work and response   |
| Provider session | The coding-agent session attached to the task                       |
| Environment      | The local checkout or isolated Git worktree where the task operates |

A project can contain many tasks. Each task has its own transcript and provider lifecycle. Tasks
using separate worktrees also have separate working directories and branches.

## The main surfaces

- **Sidebar** — projects, spaces, tasks, and activity requiring attention. Prod and Dev builds offer a
  rail layout (Settings → General → Sidebar layout): a fixed column of icon tabs for Home, Spaces,
  Kanban, Pull requests, Automations, and Settings, with the thread panel beside it and the
  route shown as a card inset from the window.
- **Conversation** — user messages, agent responses, plans, tools, approvals, and subagent activity
- **Composer** — objectives, attachments, provider selection, model selection, and task controls
- **Terminal** — a real shell opened in the task's working directory
- **Browser** — a shared live page surface for previews, semantic automation, and page-declared
  WebMCP tools
- **Diff and Git views** — the changes produced in the environment and the path toward committing or
  opening a PR

You do not need every surface open at once. Bring each one in when it answers a question: what is
running, what changed, whether the UI works, or whether the task is safe to ship.

## Projects

A project is the folder Glade works with.

Git repositories unlock the complete delivery workflow:

- Branches
- Worktrees
- Diffs
- Commits
- Pushes
- Pull requests

Non-Git folders can still be useful for simpler work, but they do not provide the same isolation and
review guarantees.

## Tasks and turns

A task is the durable container for one objective.

A turn is one cycle inside that task:

1. You send an instruction.
2. The provider plans or acts.
3. Tools and approvals appear in the transcript.
4. The provider completes, fails, or is interrupted.
5. You review the result and decide what happens next.

A long task can contain many turns. Keep follow-ups connected to the same objective; create another
task when the work needs a different owner, branch, or review boundary.

Provider sessions running inside Glade can use the built-in agent gateway to create tasks, wait for
them, read transcripts, and coordinate their work. The gateway is available through provider MCP
tools within those sessions; it does not require external agent pairing.

For work that should continue across several turns, set a deliberate
thread goal. A goal can continue after a
clean turn, but queued user work, approvals, questions, interruptions, failures, and pause rules
remain in control.

Use a thread fork when a new task should inherit
the conversation or split from one exact turn. Use a
handoff through the model picker when another provider should continue
the work in a new task.

## Environments

A task runs in one of two common environments.

| Environment    | Use it when                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Local checkout | One task owns the repository and you intentionally want it to edit the currently checked-out working tree                                     |
| Git worktree   | Another task may touch the repository, you want an isolated branch, or you want to discard an experiment without disturbing the main checkout |

A worktree is another working directory attached to the same Git repository. It shares repository
history while keeping files and branch state separate.

Keep separate working directories when starting several tasks in the same repository.

### Cleaning up worktrees

Deleting a task offers to delete its worktree when no other task uses it. Turn on **Delete worktree
on archive** in **Settings → General** to remove a finished task's clean checkout after its Undo
period ends. If another task still refers to the checkout, the session has not stopped, or Git finds
uncommitted changes, the checkout stays. Automatic archive cleanup preserves its branch so commits
remain recoverable. Restoring an archived task later restores its conversation, but a removed
checkout must be recreated from that branch before work resumes. **Settings → Managed worktrees**
lists managed worktrees for explicit removal. Those removals also delete the temporary `glade/*`
branch, its empty managed folder, and recovery
snapshots cached for that path. Automatic retention keeps the 15 most recently archived worktrees
and snapshots older ones before removing them; those snapshots expire after 30 days.

## Providers, models, and sessions

A provider is the coding-agent runtime Glade operates, such as Claude Code, Codex, OpenCode, Cursor,
or another supported integration.

The provider supplies:

- Its authentication
- Its available models
- Its own tools and permissions
- Its provider-specific session behavior

Glade supplies the shared workspace around it:

- Durable tasks
- Conversation and activity presentation
- Terminals, browser, files, and diffs
- Git environments
- Approvals and user input
- Handoffs and orchestration

Each task owns a provider session. Available models and controls can differ because Glade discovers
capabilities from the installed runtime and account.

## Handoffs

On an existing task, the model picker lists connected providers and offers a shortcut to add more. Choosing a model from another provider
opens a confirmation dialog. Confirming creates a new task with the selected provider and model,
imports the conversation, and keeps the working environment. The original task remains available.
The new provider receives the imported context with your first message. The new task shows the provider transition in the transcript and its current provider in the sidebar.

Use a handoff when:

- Another provider is better suited to the next phase
- You want an independent implementation or review
- The current provider is unavailable or rate-limited
- You want to continue without manually rebuilding the task context

A handoff does not remove the need to inspect the diff or verify the new provider's work.

## Git, checkpoints, and review

Glade treats Git as the durable review and recovery layer.

The intended loop is:

1. Begin from a known state.
2. Let the task change the environment.
3. Inspect the diff.
4. Run verification.
5. Commit only the intended changes.
6. Push and open a pull request when appropriate.

Glade's checkpoint and revert controls can help recover task work, but committed Git history remains
the strongest boundary for important changes.

## Parallel work

Parallelism is useful only when ownership is clear.

Good parallel tasks:

- Touch independent files or subsystems
- Use separate worktrees
- Have explicit objectives
- Produce independently reviewable results

Risky parallel tasks:

- Modify the same files
- Share one local checkout
- Depend on unstated assumptions from another task
- All attempt to "finish the feature" without distinct ownership

Keep task ownership clear before scaling beyond one task.

## Useful shortcuts

`mod` means Command on macOS and Ctrl on Windows or Linux.

- `mod+n` — create a task
- `mod+j` — toggle the terminal in the right sidebar
- `mod+d` — toggle the diff view
- `mod+shift+b` — toggle the browser
- `mod+\` — split the current view

Check the [keyboard reference](./KEYBINDINGS.md) for the
complete current list.

> **The rule that matters most:** a task is complete only after you understand and verify its result
> — not when the provider reports that it is finished.

## File previews

File and explorer panels can expand across the chat area. Restore returns to the
split layout; closing the last maximized panel returns to the chat. Closing the
last panel in the ordinary split layout keeps the panel launcher open.
Explorer has separate New File and New Folder buttons that create under the selected
folder (or the workspace root). Names and renames are edited inline; context
menus also offer rename and delete. Deleting an open file closes its preview.
Right-clicking a folder can open it in the system file manager.

Editable workspace files save with Cmd/Ctrl+S. The dot beside a filename marks
unsaved changes. The file editor, diff editor, and explorer share one buffer and
writer for an open file. Successful saves update Unstaged changes without staging
the file. Navigation and prompt submission are blocked while drafts are unsaved.
Closing or reloading a dirty editor asks whether to discard its draft.

If a write fails or the file changed on disk, the draft remains available with
the error shown. Retry Cmd/Ctrl+S after fixing the cause, or reload and confirm
discarding the draft. An explicit Overwrite action in the full editor bypasses
the version check. Drafts retained after a panel closes live only in the current
app session and are not crash recovery backups.

Markdown previews support basic workspace Wiki links: `[[notes/design]]` opens
`notes/design.md` from the workspace root, and `[[notes/design|Design notes]]`
uses an alias. Include the extension for other files, such as `[[guide.pdf]]`.
Regular Markdown links remain relative to the document directory. Code, escaped
Wiki syntax, embeds, and heading/block links are left literal; this is basic file
navigation rather than full Obsidian support.
