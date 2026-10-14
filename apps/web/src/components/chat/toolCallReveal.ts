import { createContext, useContext } from "react";

/**
 * The tool call the transcript was asked to show, such as the one that started a background task
 * listed in the Environment panel. Its group and row open themselves and the row scrolls into
 * view; `nonce` makes a second request for the same call reveal it again.
 */
export interface ToolCallReveal {
  toolCallId: string;
  nonce: number;
}

export const ToolCallRevealContext = createContext<ToolCallReveal | null>(null);

/** The pending reveal's nonce when it asks for one of these tool calls, otherwise undefined. */
export function useToolCallRevealSignal(
  isRevealed: (toolCallId: string) => boolean,
): number | undefined {
  const reveal = useContext(ToolCallRevealContext);
  return reveal && isRevealed(reveal.toolCallId) ? reveal.nonce : undefined;
}
