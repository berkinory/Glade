**Target version:** 0.1.2

## Instructions for agents

- Work only on the task you were given.
- Commit only your own changes. Stage paths explicitly (`git add <paths>`), never `git add -A` or `git commit -a`.
- Do not touch, revert, reformat or "fix" other changes in the repository, including uncommitted ones from other agents.
- When your task is done and committed, mark its checkbox here.
- Add a changelog entry only when the task gives one, using that text under the target version above in CHANGELOG.md (create `## <version> - Unreleased` if it is missing). If the task has no changelog line, do not add one.

## Tasks

- [x] **T1:** Simplify General settings and the chat Environment panel
  - **General:**
    - Add icons to both Local and New worktree choices in the New threads setting, reusing the existing workspace icons.
    - Remove the Sidebar layout setting. Always use Classic and remove the Rail sidebar implementation, its state, preferences, components and references throughout the codebase. Preserve the remaining sidebar's project, space and thread functionality.
    - Remove Recently added from Project order, including its sorting implementation. Keep the other project ordering choices.
    - Remove the Thread order setting and alternative thread sorting modes. Always order threads by Recently active, including sidebar sorting menus and all other entry points.
    - Remove Sidebar sections and its visibility preference. Chats must always be visible.
    - Default Environment panel → Open by default to true. Keep the toggle available and respect an explicitly saved user choice.
  - **Chat Environment panel:**
    - Remove checkbox/completion behavior from pinned messages. Pinned entries should navigate to their message when clicked; retain pinning and unpinning.
    - Remove Project instructions entirely, including its settings, panel UI, editing/copy actions and feature-specific code and references. Keep Notepad.
  - **Cleanup and verification:**
    - Remove retired settings from schemas, defaults, reset behavior, settings search, menus and active documentation; remove feature-only code, tests and assets left unused.
    - Existing saved Rail, visibility and sorting preferences must not reactivate removed behavior. Preserve released migrations and user data.
    - Verify in the running Dev app: workspace choice icons, Classic-only navigation, project and thread ordering, always-visible Chats, the Environment panel default, pinned-message navigation and working Notepad.
    - Run `bun run check` and affected tests; use the full `bun run test` for cross-package or lifecycle changes and the required desktop/migration checks if those boundaries change.
  - **Changelog:** Improved: Settings and sidebar navigation are simpler, and pinned messages in the Environment panel jump directly to their conversation.
