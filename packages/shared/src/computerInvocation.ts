import type { ComputerControlMode } from "@glade/contracts/orchestration/orchestration";

export const COMPUTER_USE_SLASH_COMMAND = "computer-use";

export function parseComputerInvocation(text: string | undefined): { prompt: string } | null {
  if (!text) return null;

  const match = /^ {0,3}\/computer-use(?:[ \t\r\n]+([\s\S]*))?$/i.exec(text);
  return match ? { prompt: (match[1] ?? "").trim() } : null;
}

export function resolveComputerInvocationMode(input: {
  readonly messageText?: string | undefined;
  readonly dispatchOrigin?: string | undefined;
  readonly enableComputerControl?: boolean | undefined;
  readonly computerControlMode?: ComputerControlMode | undefined;
}): ComputerControlMode {
  if (input.computerControlMode !== undefined) return input.computerControlMode;
  if (input.enableComputerControl === true) return "chat";
  const userAuthored = input.dispatchOrigin === undefined || input.dispatchOrigin === "user";
  return userAuthored && parseComputerInvocation(input.messageText) ? "request" : "off";
}
