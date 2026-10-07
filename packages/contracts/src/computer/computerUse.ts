import { Schema } from "effect";

// Per-thread Computer Use: "once" covers the next turn only and reverts to "off" when it ends.
export const ComputerUseMode = Schema.Literals(["off", "once", "on"]);
export type ComputerUseMode = typeof ComputerUseMode.Type;

export const ComputerAccessScope = Schema.Literals(["read", "act", "full"]);
export type ComputerAccessScope = typeof ComputerAccessScope.Type;

// Access requests reuse the provider user-input card: the server appends a `user-input.requested`
// activity whose requestId carries this prefix, and answers to it never reach a provider.
export const COMPUTER_ACCESS_REQUEST_PREFIX = "computer-access:";
export const COMPUTER_ACCESS_QUESTION_ID = "computer-access";

export const COMPUTER_ACCESS_ANSWERS = {
  read: "Allow read",
  act: "Allow act",
  full: "Allow full control",
  deny: "Deny",
} as const;

// The card for reading the clipboard, which is gated per thread rather than per app.
export const COMPUTER_CLIPBOARD_ANSWERS = {
  allow: "Allow clipboard reading in this chat",
  deny: "Deny",
} as const;

export const isComputerAccessRequestId = (requestId: string): boolean =>
  requestId.startsWith(COMPUTER_ACCESS_REQUEST_PREFIX);

// Extra payload on the access request activity for a dedicated card; the generic question card
// ignores it.
export const ComputerAccessRequestDetails = Schema.Struct({
  app: Schema.String,
  windowId: Schema.NullOr(Schema.Int),
  windowTitle: Schema.NullOr(Schema.String),
  scope: ComputerAccessScope,
  reason: Schema.String,
});
export type ComputerAccessRequestDetails = typeof ComputerAccessRequestDetails.Type;
