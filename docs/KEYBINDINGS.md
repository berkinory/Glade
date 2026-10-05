# Keybindings

Glade reads keybindings from:

- `~/.glade/userdata/keybindings.json`

The file must be a JSON array of rules:

```json
[
  { "key": "mod+g", "command": "terminal.toggle" },
  { "key": "mod+shift+g", "command": "terminal.new", "when": "terminalFocus" }
]
```

See the full schema for more details: [`packages/contracts/src/settings/keybindings.ts`](../packages/contracts/src/settings/keybindings.ts)

On startup, Glade removes the retired `diff.change.next` and `diff.change.previous`
rules through its existing keybinding migration, preserving other custom shortcuts.
`diff.toggle` still opens Source Control. Unrelated invalid rules continue to report
configuration errors and prevent automatic rewriting of the file.

## Defaults

```json
[
  { "key": "mod+j", "command": "terminal.toggle" },
  { "key": "mod+n", "command": "terminal.new", "when": "terminalFocus" },
  { "key": "mod+w", "command": "terminal.close", "when": "terminalFocus" },
  { "key": "mod+n", "command": "chat.new", "when": "!terminalFocus" },
  { "key": "mod+shift+o", "command": "chat.new", "when": "!terminalFocus" },
  { "key": "mod+shift+n", "command": "chat.newLocal", "when": "!terminalFocus" },
  { "key": "shift+tab", "command": "model.effort.next", "when": "!terminalFocus" },
  { "key": "cmd+l", "command": "composer.focus.toggle", "when": "!terminalFocus" },
  { "key": "mod+o", "command": "editor.openFavorite" },
  { "key": "mod+s", "command": "editor.file.save", "when": "!terminalFocus" }
]
```

For most up to date defaults, see [`DEFAULT_KEYBINDINGS` in `apps/server/src/settings/defaultKeybindings.ts`](../apps/server/src/settings/defaultKeybindings.ts)

The server's shortcut and condition compiler lives in `settings/keybindingCompiler.ts`;
configuration normalization lives in `settings/keybindingConfig.ts`. The `Keybindings`
service tag is under `settings/Services`, and its file-backed implementation is under
`settings/Layers`.

## Configuration

The user file accepts up to 256 rules. Runtime bindings reserve another two rules
per supported command for platform defaults. Custom commands replace their defaults,
and custom chords take precedence without evicting unrelated saved rules. Startup
backfill leaves a full user file intact and supplies missing defaults at runtime.

### Rule Shape

Each entry supports:

- `key` (required): shortcut string, like `mod+j`, `ctrl+k`, `cmd+shift+d`
- `command` (required): action ID
- `when` (optional): boolean expression controlling when the shortcut is active

Invalid rules are ignored. Invalid config files are ignored. Warnings are logged by the server.

### Available Commands

- `terminal.toggle`: open/close the terminal in the main workspace
- `terminal.new`: create new terminal (in focused terminal context by default)
- `terminal.close`: close/kill the focused terminal (in focused terminal context by default)
- `chat.new`: create a new chat thread preserving the active thread's branch/worktree state
- `chat.newLocal`: create a new chat thread for the active project in a new environment (local/worktree determined by app settings (default `local`))
- `composer.focus.toggle`: focus or blur the chat prompt composer
- `model.effort.next`: cycle the current model's supported effort levels while the composer or model picker owns focus (Shift+Tab by default). Unsupported models keep normal reverse-tab navigation. The existing picker briefly shows the selection; interacting with it keeps it open. Menus, dialogs, terminal input, IME composition, approvals and voice capture take priority.
- `workspaceTab.previous` / `workspaceTab.next`: select the previous or next tab in the current conversation workspace, in visual order, wrapping at either end. Defaults are Command+Control+Left/Right on macOS and Ctrl+PageUp/PageDown on Windows/Linux. macOS chords work from terminal input; Windows/Linux defaults yield to a focused terminal. File editor input, preview tabs and the pinned chat tab use the existing workspace selection behavior. Change these bindings in Settings → Keyboard shortcuts.
- `thread.copyId`: copy the active thread's ID to the clipboard
- `editor.openFavorite`: open current project/worktree in the last-used editor
- `editor.file.save`: write the focused file editor's unsaved changes back to disk

### Key Syntax

Supported modifiers:

- `mod` (`cmd` on macOS, `ctrl` on non-macOS)
- `cmd` / `meta`
- `ctrl` / `control`
- `shift`
- `alt` / `option`

Examples:

- `mod+j`
- `mod+shift+d`
- `ctrl+l`
- `cmd+k`

### Keyboard layouts and desktop menus

Letter and digit shortcuts use the key produced by your keyboard layout, rather
than also matching the letter printed on the same physical key on a US keyboard.
Modified symbols retain physical-key fallback (for example Option-generated
brackets). The recorder and dispatcher use the same key identity and modifier
syntax. IME composition, dead keys and AltGraph do not execute or record shortcuts.

The desktop View menu follows effective bindings for New Terminal Tab, Toggle
Sidebar and Toggle Browser after loading, editing, resetting or reconnecting.
Only unconditional bindings without conditional chord conflicts receive native
accelerators. Bindings that Electron cannot represent safely, including modified
punctuation and layout-specific characters, remain available through the renderer;
menu clicks remain available. Linux keeps its existing restriction on native
accelerators. Fixed settings, close-tab, help, editing and zoom shortcuts retain
their existing behavior.

Recording a shortcut suspends native menu shortcuts and zoom handling while the
recording field owns focus. Configurable shortcuts in the app renderer execute
through the existing web dispatcher so focus rules remain authoritative and one
keypress invokes an action once. Reloading or replacing the window clears native
shortcut state until the renderer reports its current bindings again.

### `when` Conditions

Currently available context keys:

- `terminalFocus`
- `terminalOpen`

Supported operators:

- `!` (not)
- `&&` (and)
- `||` (or)
- parentheses: `(` `)`

Examples:

- `"when": "terminalFocus"`
- `"when": "terminalOpen && !terminalFocus"`
- `"when": "terminalFocus || terminalOpen"`

Unknown condition keys evaluate to `false`.

### Precedence

- Rules are evaluated in array order.
- For a key event, the last rule where both `key` matches and `when` evaluates to `true` wins.
- That means precedence is across commands, not only within the same command.

### Voice dictation

During recording, Enter finishes dictation. By default the transcription is added to the
current draft. Enable **Send dictation with Enter** under Chat settings to send it once after
successful transcription, using the usual follow-up queue/steer preference. Ctrl/Cmd+Enter
uses the opposite follow-up action. Shift+Enter, IME composition and open composer menus
keep their existing keyboard ownership. Clicking Stop only transcribes into the draft.

The microphone shows preparation until actual audio arrives; initial digital-zero frames
are skipped without removing later pauses. Dictation is also available during an agent
turn, alongside Stop generation. Cancelled, empty, failed or stale requests do not send.
