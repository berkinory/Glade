import type { NativeApi } from "@glade/contracts/ipc/ipc";

function formatTerminalCloseSubject(terminalTitle: string | null | undefined): string {
  const trimmedTitle = terminalTitle?.trim();
  return trimmedTitle && trimmedTitle.length > 0 ? `terminal "${trimmedTitle}"` : "this terminal";
}

export function resolveTerminalCloseTitle(options: {
  terminalId: string;
  terminalLabelsById: Record<string, string>;
  terminalTitleOverridesById: Record<string, string>;
}): string {
  return (
    options.terminalTitleOverridesById[options.terminalId]?.trim() ||
    options.terminalLabelsById[options.terminalId]?.trim() ||
    "Terminal"
  );
}

function buildTerminalCloseConfirmationMessage(terminalTitle: string | null | undefined): string {
  return `Close ${formatTerminalCloseSubject(terminalTitle)}?\nThis permanently clears the terminal history for this tab.`;
}

export function shouldPromptForTerminalClose(options: {
  confirmationEnabled: boolean;
  runningTerminalIds: readonly string[];
  terminalAttentionStatesById: Record<string, unknown>;
  terminalId: string;
}): boolean {
  if (!options.confirmationEnabled) {
    return false;
  }
  return (
    options.runningTerminalIds.includes(options.terminalId) ||
    options.terminalAttentionStatesById[options.terminalId] !== undefined
  );
}

export async function confirmTerminalTabClose(options: {
  api: Pick<NativeApi, "dialogs"> | null | undefined;
  enabled: boolean;
  terminalTitle: string | null | undefined;
}): Promise<boolean> {
  if (!options.enabled || !options.api) {
    return true;
  }

  return options.api.dialogs.confirm(buildTerminalCloseConfirmationMessage(options.terminalTitle));
}
