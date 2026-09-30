import { type ProviderKind } from "@glade/contracts/core/baseSchemas";

import type { ComposerTraitSelection } from "./composerTraits";

export const COMPUTER_CONTROL_HINT_EFFORT = "medium";

export const COMPUTER_CONTROL_HINT_MESSAGE = "Desktop actions are faster at Medium effort";
export const COMPUTER_CONTROL_HINT_ACTION_LABEL = "Use Medium";

type ComputerControlEffortHintTraits = Pick<
  ComposerTraitSelection,
  "effort" | "defaultEffort" | "effortLevels" | "ultrathinkPromptControlled"
>;

export interface ComputerControlEffortHintInput {
  readonly enableComputerControl: boolean;

  readonly computerControlAvailable: boolean;

  readonly dismissed: boolean;
  readonly provider: ProviderKind;
  readonly traits: ComputerControlEffortHintTraits;
}

export function shouldShowComputerControlEffortHint(
  input: ComputerControlEffortHintInput,
): boolean {
  if (!input.enableComputerControl || !input.computerControlAvailable || input.dismissed) {
    return false;
  }
  if (input.provider !== "claudeAgent") {
    return false;
  }
  const { effort, defaultEffort, effortLevels, ultrathinkPromptControlled } = input.traits;

  if (ultrathinkPromptControlled) {
    return false;
  }
  if (!effortLevels.some((level) => level.value === COMPUTER_CONTROL_HINT_EFFORT)) {
    return false;
  }

  if (defaultEffort === null || defaultEffort === COMPUTER_CONTROL_HINT_EFFORT) {
    return false;
  }
  return effort === defaultEffort;
}
