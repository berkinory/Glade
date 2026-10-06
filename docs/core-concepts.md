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
Glade freezes the complete durable conversation at handoff creation and prepares a structured record with the selected destination model. The record preserves constraints, decisions, unfinished work, and cited original evidence; the source provider does not need remaining quota. Preparation uses an isolated request and does not begin the task.

The new provider receives the prepared context with your first message. Preparation can be cancelled or retried in the new task without creating another task or clearing your draft. Omitted messages and activity remain available through source retrieval at the frozen boundary. The new task shows the provider transition in the transcript and its current provider in the sidebar.

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
- `mod+j` — toggle the terminal in the main workspace
- `mod+d` — toggle the diff view
- `mod+shift+b` — toggle the browser
- `mod+\` — split the current view

Check the [keyboard reference](./KEYBINDINGS.md) for the
complete current list.

> **The rule that matters most:** a task is complete only after you understand and verify its result
> — not when the provider reports that it is finished.

## File previews

File and explorer panels open beside the chat with adjustable widths. Closing the
last panel keeps the panel launcher open.
The toggle beside the file breadcrumb hides Explorer navigation completely. Reopen it from the same control; the selected file, editor draft and navigation state remain in place.

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
inside Changes; **Current changes** returns to the working tree. **Edit** reveals the current
file in a main workspace tab and preserves editor drafts. Deleted or unavailable files are identified explicitly.

History follows local Git changes, including commits, resets and branch switches made outside Glade.
**Undo commit** applies only to the latest eligible unpublished commit. It preserves the index,
working-tree edits and untracked files, and restores the message into an empty commit draft.
Root commits, merge commits, detached HEAD, published commits and active operations cannot be undone.
Glade refreshes every configured remote before revalidating publication and HEAD. Remote tags are checked separately from local tags, so matching tag names across forks do not conflict. A failed fetch
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

## Workspace search and downloads

Workspace filename search and composer file suggestions exclude tracked files deleted from
disk, even before staging. If Git cannot provide a complete deleted-path list, discovery
falls back to the filesystem. Source Control still lists deletions, with struck-through
filenames in Changes, Staged, History and turn diffs; directory paths stay readable and deleted versions have no Edit action.
A staged modification remains styled as a modification if only its working copy was deleted.

File downloads and chat exports preserve Unicode filenames using the UTF-8 download header,
with an ASCII fallback for older clients. The web download path prefers the UTF-8 name.

GitHub lookups share the configured GitHub host and credential budget across projects.
A confirmed rate limit pauses uncached reads, including manual refreshes and reads
already waiting for a Git process slot. Supplied reset/retry times are honored;
otherwise the pause backs off from one minute to at most fifteen minutes. Fresh cached
lookups remain available. An expired lookup reports the rate-limit error instead of
pretending stale data is current. User-requested mutations are never retried automatically.
Background PR association lookups use the existing lower-priority Git process queue.

Chats in a shared checkout retain their PR association when another chat changes the
branch or a lookup finds nothing. A positive replacement updates it; dedicated
worktrees retain their branch-specific association rules.

Opening a PR checks for an existing worktree before performing a Local checkout. Reuse
requires its current branch and upstream repository to match the PR head; an unknown
or different fork reports a conflict without retargeting it. The prepared result supplies
the actual branch and environment. Preparing a new Local checkout does not force away
dirty changes. Nonessential Git query refreshes continue after the prepared chat opens;
a persistent progress/error notification survives the initiating dialog.

New draft chats expose a Worktree checkbox after the branch selector, using the existing
project/environment default. It is unavailable without a Git repository. The Environment
panel shows the actual working directory, the worktree root when different, and whether
a draft worktree will be created on the first send. The project picker lists projects
and local folders, keeping an explicitly selected unregistered path visible without
adding other chats' worktrees as projects.

Send and worktree preparation belong to the sending thread. Switching chats preserves
its Cancel/Work locally controls, and another draft can be opened while preparation
runs. The thread is created before worktree setup so it remains reachable. A failed
send restores content to its captured thread, preserving newer edits and attachments.
An unconfirmed delivery keeps the workspace and uploads intact and asks you to check
the chat before retrying; it is not automatically resent. Entering prompt history with
Up requires an empty composer; normal Up/Down history navigation still works afterward.
Images still being prepared when you switch chats are discarded and their previews
released; they never attach to another chat or change its pending count.

### Reading and linking conversations

The conversation scrolls vertically; wide code blocks scroll horizontally within their own boundaries. Environment clips its sliding panel at the overlay boundary in floating and docked modes, while its content and bottom rail remain vertically scrollable.

The message navigation rail appears only when the space left of the chosen chat width, after any docked panel, can hold it. Otherwise it hides and gives up keyboard focus. Activity rows omit routine single-use accepted approvals; refusals, cancellations, errors, session or permission grants and every Computer consent stay visible.

Agent details retain the mounted conversation, including scroll position and expanded rows. Returning restores keyboard focus. Transcript edge fades follow scroll progress; unsupported scroll-timeline browsers keep the content clear and retain the composer footer dissolve.

Ordinary Markdown images open the existing image preview with click, Enter or Space. Images inside links follow that link exclusively, including unavailable local images. Local previews still require workspace authorization. Closing a preview returns focus to its trigger.

Use `[chat title](#chat=THREAD_ID)` in Markdown to link a conversation in this Glade workspace. The fragment is an internal Markdown convention mapped to the existing `/$threadId` route, not an operating-system URL handler. IDs may be percent-encoded and must decode to 1–128 ASCII letters, digits, underscores or hyphens. The target must exist in the accessible server chat list; missing or malformed targets show an error without navigating or discarding drafts. Titles are labels, never lookup keys. Ordinary web and file links retain their existing handling.

## Sidebar continuity

Unsent text and attachments mark existing chats in both sidebar views. Activity puts
unpinned drafts together; pinned chats keep their priority. Unsent local chats also
appear in Activity without creating a provider session. Browsing prompt history
uses the saved draft for this indicator. The open chat remains reachable outside
collapsed or paginated sections without changing their expansion or page count.

Activity remembers its project filter per server/profile and validates it after
hydration. Read markers use server timestamps and bounded browser metadata, restored
before chat normalization, so replies completed while Glade is closed stay unread.
Other windows share changes through browser storage; unavailable storage leaves
in-memory behavior usable.

Recent rows reuse project appearance, preferring explicit emoji, icon or color over
a favicon. Favicon discovery checks root and declared icons first, then a bounded
set of shallow frontend directories. Symlinks outside the project and oversized
files are rejected. Workspace resize handles live outside the clipped panel surface.
