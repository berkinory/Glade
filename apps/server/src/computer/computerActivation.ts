import type { ComputerControlMode } from "@glade/contracts";
import { resolveComputerInvocationMode } from "@glade/shared/computerInvocation";

export function computerActivationMetadata(input: {
  readonly enableComputerControl?: boolean | undefined;
  readonly computerControlMode?: ComputerControlMode | undefined;
  readonly computerControlGeneration?: number | undefined;

  readonly userMessageText?: string | undefined;
  readonly dispatchOrigin?: string | undefined;
}): {
  computerControlMode: ComputerControlMode;
  enableComputerControl: boolean;
  computerControlGeneration: number;
} {
  const computerControlMode =
    input.userMessageText === undefined
      ? resolveComputerInvocationMode(input)
      : resolveComputerInvocationMode({
          messageText: input.userMessageText,
          dispatchOrigin: input.dispatchOrigin,
          enableComputerControl:
            input.computerControlMode === "chat" ||
            (input.computerControlMode === undefined && input.enableComputerControl === true),
        });
  return {
    computerControlMode,
    enableComputerControl: computerControlMode !== "off",
    computerControlGeneration: input.computerControlGeneration ?? 0,
  };
}
