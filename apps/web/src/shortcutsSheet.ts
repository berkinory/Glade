import {
  STATIC_KEYBINDING_COMMANDS,
  type KeybindingCommand,
  type ResolvedKeybindingRule,
  type ResolvedKeybindingsConfig,
} from "@glade/contracts/settings/keybindings";
import { isMacPlatform } from "./lib/utils";
import { formatShortcutLabel, resolveKeybindingForCommand } from "./keybindings";

export interface ShortcutSheetContext {
  terminalFocus: boolean;
  terminalOpen: boolean;
  terminalWorkspaceOpen: boolean;
  [key: string]: boolean;
}

export interface ShortcutSheetEntry {
  id: string;
  command: KeybindingCommand | null;
  binding: ResolvedKeybindingRule | null;
  label: string;
  description: string;
  shortcutLabel: string;
}

export interface ShortcutSheetSection {
  id: string;
  title: string;
  description: string;
  tone?: "default" | "muted";
  entries: ShortcutSheetEntry[];
}

interface BuildShortcutSheetSectionsOptions {
  keybindings: ResolvedKeybindingsConfig;
  platform: string;
  context: ShortcutSheetContext;
}

interface ShortcutDefinition {
  command: KeybindingCommand | readonly KeybindingCommand[];
  label: string;
  description: string;
}

const SPACE_JUMP_DEFINITIONS: readonly ShortcutDefinition[] = Array.from(
  { length: 9 },
  (_, index) => ({
    command: `space.jump.${index + 1}` as KeybindingCommand,
    label: index === 0 ? "Jump to first space" : `Jump to space ${index + 1}`,
    description:
      index === 0
        ? "Switch straight to the first tab of the space switcher."
        : "Switch straight to this tab of the space switcher.",
  }),
);

const AVAILABLE_NOW_DEFINITIONS: readonly ShortcutDefinition[] = [
  {
    command: "sidebar.addProject",
    label: "Add project",
    description: "Open the Create project dialog to import a local folder.",
  },
  {
    command: "sidebar.search",
    label: "Search projects and chats",
    description: "Open the sidebar search palette from anywhere in the app.",
  },
  {
    command: "sidebar.activity",
    label: "Toggle Activity",
    description: "Show or hide running tasks, completed work, and items that need attention.",
  },
  {
    command: "space.previous",
    label: "Previous space",
    description: "Switch to the previous project space and restore its last working context.",
  },
  {
    command: "space.next",
    label: "Next space",
    description: "Switch to the next project space and restore its last working context.",
  },
  ...SPACE_JUMP_DEFINITIONS,
  {
    command: "chat.new",
    label: "New chat",
    description: "Start a fresh chat in the current project, or the most recent one.",
  },
  {
    command: "chat.newLatestProject",
    label: "New chat in latest project",
    description: "Jump back into the most recently used project with a new chat.",
  },
  {
    command: ["chat.newChat", "chat.newLocal"],
    label: "New chat",
    description: "Open the empty chat landing view.",
  },
  {
    command: "chat.newClaude",
    label: "New Claude chat",
    description: "Start a fresh chat with Claude selected.",
  },
  {
    command: "chat.newCodex",
    label: "New Codex chat",
    description: "Start a fresh chat with Codex selected.",
  },
  {
    command: "chat.split",
    label: "Split chat",
    description: "Open the current conversation in a second pane.",
  },
  {
    command: "view.recent.previous",
    label: "Previous recent view",
    description: "Cycle backward through recently opened primary views.",
  },
  {
    command: "view.recent.next",
    label: "Next recent view",
    description: "Cycle forward through recently opened primary views.",
  },
  {
    command: "modelPicker.toggle",
    label: "Model picker",
    description: "Open the composer provider and model picker.",
  },
  {
    command: "model.effort.next",
    label: "Next model effort",
    description: "Cycle supported reasoning effort levels in the composer or model picker.",
  },
  {
    command: "model.next",
    label: "Next model",
    description:
      "Cycle to the next model for the active provider (favorites first, then remaining models).",
  },
  {
    command: "model.previous",
    label: "Previous model",
    description:
      "Cycle to the previous model for the active provider (favorites first, then remaining models).",
  },
  {
    command: "traitsPicker.toggle",
    label: "Reasoning picker",
    description: "Open the composer reasoning and trait controls.",
  },
  {
    command: "settings.usage",
    label: "Open usage settings",
    description: "Open Settings → Usage & limits for provider quota and token totals.",
  },
  {
    command: "composer.focus.toggle",
    label: "Focus composer",
    description: "Focus or blur the chat prompt composer.",
  },
  {
    command: "chat.find",
    label: "Find in chat",
    description: "Search the current transcript and jump to each matching message.",
  },
  {
    command: "terminal.toggle",
    label: "Toggle terminal",
    description: "Show or hide the terminal surface for the active chat.",
  },
  {
    command: "terminal.new",
    label: "New terminal tab",
    description: "Open a new tab in the focused terminal.",
  },
  {
    command: "terminal.close",
    label: "Close terminal tab",
    description: "Close the focused terminal tab.",
  },
  {
    command: "diff.toggle",
    label: "Toggle Source Control",
    description: "Open or close Source Control.",
  },
  {
    command: "thread.copyId",
    label: "Copy thread ID",
    description: "Copy the active thread's ID to the clipboard.",
  },
  {
    command: "chat.visible.previous",
    label: "Previous visible chat",
    description: "Cycle to the previous chat that is currently visible in the sidebar.",
  },
  {
    command: "chat.visible.next",
    label: "Next visible chat",
    description: "Cycle to the next chat that is currently visible in the sidebar.",
  },
  {
    command: "editor.openFavorite",
    label: "Open in favorite editor",
    description: "Send the current chat or workspace target to your preferred editor.",
  },
  {
    command: "editor.file.save",
    label: "Save file",
    description: "Write the focused editor's unsaved changes back to disk.",
  },
  {
    command: "git.commitAndPush",
    label: "Commit and push",
    description: "Commit pending changes and push the active chat's repo.",
  },
] as const;

const THREAD_JUMP_DEFINITIONS: readonly ShortcutDefinition[] = Array.from(
  { length: 9 },
  (_, index) => ({
    command: `thread.jump.${index + 1}` as KeybindingCommand,
    label: `Jump to visible thread ${index + 1}`,
    description: "Focus a visible chat directly from the sidebar number row.",
  }),
);

const WORKSPACE_DEFINITIONS: readonly ShortcutDefinition[] = [
  {
    command: "workspaceTab.previous",
    label: "Previous workspace tab",
    description: "Select the previous resource tab in this conversation, wrapping at the start.",
  },
  {
    command: "workspaceTab.next",
    label: "Next workspace tab",
    description: "Select the next resource tab in this conversation, wrapping at the end.",
  },
  {
    command: "terminal.workspace.newFullWidth",
    label: "Open full-width terminal workspace",
    description: "Expand the active chat into the workspace terminal layout.",
  },
  {
    command: "terminal.workspace.terminal",
    label: "Focus terminal tab",
    description: "Switch the workspace to the terminal tab.",
  },
  {
    command: "terminal.workspace.chat",
    label: "Focus chat tab",
    description: "Switch the workspace back to the chat tab.",
  },
  {
    command: "terminal.workspace.closeActive",
    label: "Close active workspace panel",
    description: "Close the currently focused workspace panel or tab.",
  },
] as const;

const SIDEBAR_TOGGLE_DEFINITION: ShortcutDefinition = {
  command: "sidebar.toggle",
  label: "Toggle sidebar",
  description: "Collapse or reveal the sidebar shell.",
};

export interface EditableShortcutDefinition {
  command: KeybindingCommand;
  label: string;
  description: string;
}

export function listEditableShortcutDefinitions(): EditableShortcutDefinition[] {
  const definitionsByCommand = new Map<KeybindingCommand, EditableShortcutDefinition>();
  for (const definition of [
    SIDEBAR_TOGGLE_DEFINITION,
    ...AVAILABLE_NOW_DEFINITIONS,
    ...WORKSPACE_DEFINITIONS,
    ...THREAD_JUMP_DEFINITIONS,
  ]) {
    const commands = Array.isArray(definition.command) ? definition.command : [definition.command];
    for (const command of commands) {
      definitionsByCommand.set(command, {
        command,
        label: definition.label,
        description: definition.description,
      });
    }
  }

  return STATIC_KEYBINDING_COMMANDS.map(
    (command): EditableShortcutDefinition =>
      definitionsByCommand.get(command) ?? {
        command,
        label: command,
        description: "Assign a shortcut to this built-in command.",
      },
  );
}

function modSlashLabel(platform: string): string {
  return isMacPlatform(platform) ? "⌘/" : "Ctrl+/";
}

function definitionToEntry(
  definition: ShortcutDefinition,
  keybindings: ResolvedKeybindingsConfig,
  platform: string,
  context: ShortcutSheetContext,
): ShortcutSheetEntry | null {
  const commands = Array.isArray(definition.command) ? definition.command : [definition.command];
  const binding = commands.reduce<ResolvedKeybindingRule | null>(
    (resolved, command) =>
      resolved ?? resolveKeybindingForCommand(keybindings, command, { platform, context }),
    null,
  );
  if (!binding) return null;
  return {
    id: binding.command,
    command: binding.command,
    binding,
    label: definition.label,
    description: definition.description,
    shortcutLabel: formatShortcutLabel(binding.shortcut, platform),
  };
}

function definitionsToEntries(
  definitions: ReadonlyArray<ShortcutDefinition>,
  keybindings: ResolvedKeybindingsConfig,
  platform: string,
  context: ShortcutSheetContext,
): ShortcutSheetEntry[] {
  return definitions
    .map((definition) => definitionToEntry(definition, keybindings, platform, context))
    .filter((entry): entry is ShortcutSheetEntry => entry !== null);
}

export function buildShortcutSheetSections(
  options: BuildShortcutSheetSectionsOptions,
): ShortcutSheetSection[] {
  const sections: ShortcutSheetSection[] = [];

  const currentEntries: ShortcutSheetEntry[] = [
    {
      id: "shortcuts.show",
      command: null,
      binding: null,
      label: "Keyboard shortcuts",
      description: "Open this sheet from anywhere without leaving your current context.",
      shortcutLabel: modSlashLabel(options.platform),
    },
    ...definitionsToEntries(
      AVAILABLE_NOW_DEFINITIONS,
      options.keybindings,
      options.platform,
      options.context,
    ),
  ];

  const sidebarToggle = definitionToEntry(
    SIDEBAR_TOGGLE_DEFINITION,
    options.keybindings,
    options.platform,
    options.context,
  );
  if (sidebarToggle) {
    currentEntries.splice(1, 0, sidebarToggle);
  }

  const currentNavigationEntries = options.context.terminalWorkspaceOpen
    ? definitionsToEntries(
        WORKSPACE_DEFINITIONS,
        options.keybindings,
        options.platform,
        options.context,
      )
    : definitionsToEntries(
        THREAD_JUMP_DEFINITIONS,
        options.keybindings,
        options.platform,
        options.context,
      );

  sections.push({
    id: "available-now",
    title: "Available now",
    description: options.context.terminalWorkspaceOpen
      ? "These reflect the active workspace-terminal context."
      : "These reflect the current chat and sidebar context.",
    entries: [...currentEntries, ...currentNavigationEntries],
  });

  const alternateContext: ShortcutSheetContext = options.context.terminalWorkspaceOpen
    ? { ...options.context, terminalWorkspaceOpen: false }
    : {
        ...options.context,
        terminalOpen: true,
        terminalWorkspaceOpen: true,
      };
  const alternateDefinitions = options.context.terminalWorkspaceOpen
    ? THREAD_JUMP_DEFINITIONS
    : WORKSPACE_DEFINITIONS;
  const alternateEntries = definitionsToEntries(
    alternateDefinitions,
    options.keybindings,
    options.platform,
    alternateContext,
  );
  if (alternateEntries.length > 0) {
    sections.push({
      id: "alternate-context",
      title: options.context.terminalWorkspaceOpen ? "Outside workspace mode" : "In workspace mode",
      description: options.context.terminalWorkspaceOpen
        ? "Number-row jumps return when the terminal workspace is closed."
        : "These bindings take over when the terminal switches into workspace mode.",
      tone: "muted",
      entries: alternateEntries,
    });
  }

  return sections;
}

function shortcutSheetEntryMatchesQuery(entry: ShortcutSheetEntry, needle: string): boolean {
  return (
    entry.label.toLowerCase().includes(needle) ||
    entry.description.toLowerCase().includes(needle) ||
    entry.shortcutLabel.toLowerCase().includes(needle)
  );
}

export function filterShortcutSheetSections(
  sections: ShortcutSheetSection[],
  query: string,
): ShortcutSheetSection[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return sections;
  return sections
    .map((section) => ({
      ...section,
      entries: section.entries.filter((entry) => shortcutSheetEntryMatchesQuery(entry, trimmed)),
    }))
    .filter((section) => section.entries.length > 0);
}
