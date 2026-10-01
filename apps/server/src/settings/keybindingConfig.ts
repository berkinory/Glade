import { Array, Schema, SchemaGetter } from "effect";
import {
  KeybindingsConfig,
  KeybindingRule,
  ResolvedKeybindingsConfig,
  MAX_KEYBINDINGS_COUNT,
} from "@glade/contracts/settings/keybindings";
import { type ServerConfigIssue } from "@glade/contracts/server/server";
import {
  SIDEBAR_SEARCH_DEFAULT_KEYBINDINGS,
  DEFAULT_RESOLVED_KEYBINDINGS,
} from "./defaultKeybindings";

type RawKeybindingsEntriesResult =
  | {
      readonly _tag: "success";
      readonly entries: ReadonlyArray<unknown>;
      readonly migratedShape: boolean;
    }
  | { readonly _tag: "failure"; readonly detail: string };

function describeJsonValueShape(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function decodeRawKeybindingsEntries(rawConfig: string): RawKeybindingsEntriesResult {
  if (rawConfig.trim().length === 0) {
    return { _tag: "success", entries: [], migratedShape: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch (error) {
    return { _tag: "failure", detail: `expected JSON array (${String(error)})` };
  }

  if (Array.isArray(parsed)) {
    return { _tag: "success", entries: parsed, migratedShape: false };
  }
  if (parsed === null) {
    return { _tag: "success", entries: [], migratedShape: true };
  }
  if (typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.keybindings)) {
      return { _tag: "success", entries: record.keybindings, migratedShape: true };
    }
    if (Object.keys(record).length === 0) {
      return { _tag: "success", entries: [], migratedShape: true };
    }
    if (typeof record.key === "string" && typeof record.command === "string") {
      return { _tag: "success", entries: [record], migratedShape: true };
    }
  }
  return {
    _tag: "failure",
    detail: `expected JSON array, got ${describeJsonValueShape(parsed)}`,
  };
}

const KeybindingsConfigJson = Schema.fromJsonString(KeybindingsConfig);

const PrettyJsonString = SchemaGetter.parseJson<string>().compose(
  SchemaGetter.stringifyJson({ space: 2 }),
);

export const KeybindingsConfigPrettyJson = KeybindingsConfigJson.pipe(
  Schema.encode({
    decode: PrettyJsonString,
    encode: PrettyJsonString,
  }),
);

function trimIssueMessage(message: string): string {
  const trimmed = message.trim();
  return trimmed.length > 0 ? trimmed : "Invalid keybindings configuration.";
}

export function malformedConfigIssue(detail: string): ServerConfigIssue {
  return {
    kind: "keybindings.malformed-config",
    message: trimIssueMessage(detail),
  };
}

export function invalidEntryIssue(index: number, detail: string): ServerConfigIssue {
  return {
    kind: "keybindings.invalid-entry",
    index,
    message: trimIssueMessage(detail),
  };
}

const LEGACY_KEYBINDING_COMMAND_ALIASES = {
  "commandPalette.toggle": "sidebar.search",
  "composer.effortPicker.toggle": "traitsPicker.toggle",
  "composer.modelPicker.toggle": "modelPicker.toggle",
  "effortPicker.toggle": "traitsPicker.toggle",
  "reasoningPicker.toggle": "traitsPicker.toggle",
  "thread.previous": "chat.visible.previous",
  "thread.next": "chat.visible.next",
} as const satisfies Record<string, KeybindingRule["command"]>;

const RETIRED_LEGACY_KEYBINDING_COMMANDS = new Set(["chat.newGemini", "chat.newTerminal"]);

const RETIRED_LEGACY_KEYBINDING_COMMAND_PATTERN = /^(?:composer\.)?modelPicker\.jump\.[1-9]$/;

const OUTDATED_RECENT_VIEW_TERMINAL_GUARD = "!terminalFocus";

const OUTDATED_SIDEBAR_SEARCH_SHORTCUT = "mod+k";

const RECENT_VIEW_SHORTCUT_BY_COMMAND: Partial<Record<KeybindingRule["command"], string>> = {
  "view.recent.next": "ctrl+tab",
  "view.recent.previous": "ctrl+shift+tab",
};

// On macOS `mod` is Cmd and xterm never forwards a Cmd-chord to the PTY, so that guard silently
// dropped "new chat/terminal" chords whenever the terminal had focus. The relaxed guard adds an `||
// isMac` escape hatch (see DEFAULT_KEYBINDINGS) so the chord fires on macOS regardless of focus
// while Linux/Windows keep yielding Ctrl-chords to the shell.
const OUTDATED_CREATION_TERMINAL_GUARD = "!terminalFocus";

const RELAXED_CREATION_TERMINAL_GUARD = "!terminalFocus || isMac";

const OUTDATED_THREAD_JUMP_GUARD = "!terminalFocus && !terminalWorkspaceOpen";

const RELAXED_THREAD_JUMP_GUARD = "(!terminalFocus && !terminalWorkspaceOpen) || isMac";

const OUTDATED_WORKSPACE_TAB_SHORTCUT_BY_COMMAND: Partial<
  Record<KeybindingRule["command"], string>
> = {
  "terminal.workspace.terminal": "mod+1",
  "terminal.workspace.chat": "mod+2",
};

const CREATION_COMMANDS_WITH_TERMINAL_ESCAPE = new Set<KeybindingRule["command"]>([
  "chat.new",
  "chat.newLatestProject",
  "chat.newChat",
  "chat.newLocal",
  "chat.newClaude",
  "chat.newCodex",
  "chat.split",
]);

export function readKeybindingEntryCommand(entry: unknown): string | null {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return null;
  }

  const command = (entry as { command?: unknown }).command;
  return typeof command === "string" ? command : null;
}

export function isRetiredLegacyKeybindingCommand(command: string): boolean {
  return (
    RETIRED_LEGACY_KEYBINDING_COMMANDS.has(command) ||
    RETIRED_LEGACY_KEYBINDING_COMMAND_PATTERN.test(command)
  );
}

export // Cross-device configs can lag behind command renames; normalize known aliases before schema
// validation so stale synced files do not become warning toasts.
function normalizeLegacyKeybindingEntry(entry: unknown): {
  readonly entry: unknown;
  readonly migrated: boolean;
} {
  const command = readKeybindingEntryCommand(entry);
  if (typeof command !== "string" || !(command in LEGACY_KEYBINDING_COMMAND_ALIASES)) {
    return { entry, migrated: false };
  }

  return {
    entry: {
      ...(entry as Record<string, unknown>),
      command:
        LEGACY_KEYBINDING_COMMAND_ALIASES[
          command as keyof typeof LEGACY_KEYBINDING_COMMAND_ALIASES
        ],
    },
    migrated: true,
  };
}

export // Update exact old recent-view defaults so existing configs gain terminal-focus support (drop the
// `!terminalFocus` guard). Per-rule because it never changes the key, so it cannot collide with a
// sibling entry.
function migrateOutdatedDefaultKeybindingRule(rule: KeybindingRule): {
  readonly rule: KeybindingRule;
  readonly migrated: boolean;
} {
  const recentViewShortcut = RECENT_VIEW_SHORTCUT_BY_COMMAND[rule.command];
  if (
    recentViewShortcut === undefined ||
    rule.key !== recentViewShortcut ||
    rule.when !== OUTDATED_RECENT_VIEW_TERMINAL_GUARD
  ) {
    return { rule, migrated: false };
  }

  return {
    rule: {
      key: rule.key,
      command: rule.command,
    },
    migrated: true,
  };
}

export function migrateOutdatedSidebarSearchDefault(rules: readonly KeybindingRule[]): {
  readonly rules: KeybindingRule[];
  readonly migratedCount: number;
} {
  let migratedCount = 0;
  const next = rules.flatMap((rule) => {
    if (
      rule.command !== "sidebar.search" ||
      rule.key !== OUTDATED_SIDEBAR_SEARCH_SHORTCUT ||
      rule.when !== undefined
    ) {
      return [rule];
    }

    migratedCount += 1;
    return SIDEBAR_SEARCH_DEFAULT_KEYBINDINGS.map((binding) => ({ ...binding }));
  });
  return { rules: next, migratedCount };
}

export function relaxCreationCommandTerminalGuards(rules: readonly KeybindingRule[]): {
  readonly rules: KeybindingRule[];
  readonly migratedCount: number;
} {
  let migratedCount = 0;
  const next = rules.map((rule) => {
    if (
      rule.when !== OUTDATED_CREATION_TERMINAL_GUARD ||
      !CREATION_COMMANDS_WITH_TERMINAL_ESCAPE.has(rule.command)
    ) {
      return rule;
    }
    migratedCount += 1;
    return { ...rule, when: RELAXED_CREATION_TERMINAL_GUARD };
  });
  return { rules: next, migratedCount };
}

export function migrateNumberedTerminalWorkspaceDefaults(rules: readonly KeybindingRule[]): {
  readonly rules: KeybindingRule[];
  readonly migratedCount: number;
} {
  let migratedCount = 0;
  const next = rules.map((rule) => {
    const outdatedWorkspaceShortcut = OUTDATED_WORKSPACE_TAB_SHORTCUT_BY_COMMAND[rule.command];
    if (
      outdatedWorkspaceShortcut !== undefined &&
      rule.key === outdatedWorkspaceShortcut &&
      rule.when === "terminalWorkspaceOpen"
    ) {
      migratedCount += 1;
      return { ...rule, key: rule.command === "terminal.workspace.terminal" ? "ctrl+1" : "ctrl+2" };
    }

    if (
      /^thread\.jump\.[1-9]$/.test(rule.command) &&
      rule.key === `mod+${rule.command.slice(-1)}` &&
      rule.when === OUTDATED_THREAD_JUMP_GUARD
    ) {
      migratedCount += 1;
      return { ...rule, when: RELAXED_THREAD_JUMP_GUARD };
    }

    return rule;
  });
  return { rules: next, migratedCount };
}

export function mergeWithDefaultKeybindings(
  custom: ResolvedKeybindingsConfig,
): ResolvedKeybindingsConfig {
  if (custom.length === 0) {
    return [...DEFAULT_RESOLVED_KEYBINDINGS];
  }

  const overriddenCommands = new Set(custom.map((binding) => binding.command));
  const retainedDefaults = DEFAULT_RESOLVED_KEYBINDINGS.filter(
    (binding) => !overriddenCommands.has(binding.command),
  );
  const merged = [...retainedDefaults, ...custom];

  if (merged.length <= MAX_KEYBINDINGS_COUNT) {
    return merged;
  }

  return merged.slice(-MAX_KEYBINDINGS_COUNT);
}
