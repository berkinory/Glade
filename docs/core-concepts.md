# Core concepts

Glade becomes much easier to use once its ownership model is clear: **each task owns one body of
work** — its conversation, provider session, working environment, tool activity, and Git changes.

## The hierarchy

| Concept          | Meaning                                                             |
| ---------------- | ------------------------------------------------------------------- |
| Workspace        | The complete Glade application and the projects available in it     |
| Project          | A local folder, preferably a Git repository                         |
| Task             | One durable unit of work inside a project                           |
| Turn             | One user instruction followed by the provider's work and response   |
| Provider session | The coding-agent session attached to the task                       |
| Environment      | The local checkout or isolated Git worktree where the task operates |

A project can contain many tasks. Each task has its own transcript and provider lifecycle. Tasks
using separate worktrees also have separate working directories and branches.

## The main surfaces

- **Sidebar** — projects, spaces, chats, and activity requiring attention. Threads are ordered by
  recent activity; projects support manual order or recent activity.
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

Normal follow-ups reuse the provider runtime. Codex 0.158.0+ and Claude associate gateway calls
with provider-generated call ids and the turn that issued them. Completed or interrupted turns
cannot borrow the next turn's write authority. Older Codex runtimes are renewed between turns because their gateway
transport cannot prove which turn issued a call. Stop drains and retires the interrupted runtime
before resuming native history. Background recovery keeps the composer available.

The transcript keeps one waiting indicator until answer text takes its place. Starting or
finishing a turn does not insert or remove a timer above the reply. Session updates from
the live stream and sidebar snapshots cannot overwrite a newer session state.

A long task can contain many turns. Keep follow-ups connected to the same objective; create another
task when the work needs a different owner, branch, or review boundary.

Provider sessions running inside Glade can use the built-in agent gateway to create tasks, wait for
them, read transcripts, and coordinate their work. The gateway is available through provider MCP
tools within those sessions; it does not require external agent pairing.

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
on archive** in **Settings → Git & worktrees** to remove a finished task's clean checkout after its Undo
period ends. If another task still refers to the checkout, the session has not stopped, or Git finds
uncommitted changes, the checkout stays. Automatic archive cleanup preserves its branch so commits
remain recoverable. Restoring an archived task later restores its conversation, but a removed
checkout must be recreated from that branch before work resumes. **Settings → Git & worktrees**
lists managed worktrees for explicit removal. Those removals also delete the temporary `glade/*`
branch, its empty managed folder, and recovery
snapshots cached for that path. Automatic retention keeps the 15 most recently archived worktrees
and snapshots older ones before removing them; those snapshots expire after 30 days.

## Providers, models, and sessions

A provider is the coding-agent runtime Glade operates, currently Claude Code or Codex.

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

Editing and resending the latest message restores its preceding workspace checkpoint and replays
the corrected prompt in the same chat. Codex rewinds its native conversation;
Claude resumes a native copy of the exact retained prefix, including tool results. Editing does
not replace the retained history with a generated summary. File-change cards also support
undoing their changes.
Checkpoint restores preserve unchanged files and the Git staging area. Committed Git history
remains the strongest boundary for important changes.

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
Explorer hides `.git`, `.svn`, `.hg`, `.jj`, `.DS_Store`, and `Thumbs.db`.
Gitignored files and folders appear dimmed. Enable **Hide ignored files** in Settings
to leave them out of the tree; this setting is off by default.

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

### Source Control history and synchronized push

Source Control contains Changes and History. Turn-summary links select the exact turn checkpoint
inside Changes; **Current changes** returns to the working tree. **Show file** reveals the current
file in Explorer and preserves editor drafts. Deleted or unavailable files are identified explicitly.

History follows local Git changes, including commits, resets and branch switches made outside Glade.
**Undo commit** applies only to the latest eligible unpublished commit. It preserves the index,
working-tree edits and untracked files, and restores the message into an empty commit draft.
Root commits, merge commits, detached HEAD, published commits and active operations cannot be undone.
Glade refreshes every configured remote before revalidating publication and HEAD; a failed fetch
blocks undo. Branches without an upstream are checked against all remote-tracking refs and tags.

Push fetches its destination, fast-forwards an exclusively behind branch, or rebases unpublished
local commits before a normal push. Integration requires saved editors and a clean working tree;
direct pushes can keep local edits. No automatic stash or force push is performed. Mismatched
fetch/push destinations, outgoing merge commits and published outgoing commits require manual
integration. A concurrent remote update can reject the normal push safely; retry Push to synchronize.

Conflicts are listed with links to Explorer. Stage resolved files, then use the controls for the
actual operation. A rebase initiated by Push retains its pending push in worktree-local Git metadata
across restart. Continue resumes that push; Abort restores the pre-rebase state and cancels it.
Externally started rebases never acquire an automatic push. If an operation finished outside Glade,
the pending push requires an explicit Resume or Cancel. Conflicts without an operation, such as a
stash conflict, offer file resolution without a misleading rebase abort action.

## Activity model attribution

Activity uses the model recorded for a historical turn or its reliable provider usage evidence. Older default selections without a recoverable model appear as Unknown model with the provider name. They retain their tokens and turns, including after chat deletion. Changing a chat's model does not relabel its earlier unknown usage. Token statistics and the turn-count fallback use the same grouping; their metrics remain distinct.
