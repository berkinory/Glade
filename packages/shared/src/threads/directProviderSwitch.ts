interface SwitchCandidateMessage {
  readonly role: string;
  readonly text: string;
  readonly turnId?: string | null | undefined;
  readonly source?: string | undefined;
  readonly streaming: boolean;
}

// A chat whose sends never reached a provider has no provider conversation to hand off: no provider
// turn ever started, nothing came back, and no fork or handoff seeded a native session. Switching such
// a chat changes the model directly and resends its latest message. Anything else stays a handoff.
export function resolveDirectProviderSwitchMessage<M extends SwitchCandidateMessage>(thread: {
  readonly latestTurn: unknown;
  readonly parentThreadId?: string | null | undefined;
  readonly forkSourceThreadId?: string | null | undefined;
  readonly handoff?: unknown;
  readonly messages: ReadonlyArray<M>;
}): M | null {
  if (
    thread.latestTurn != null ||
    thread.parentThreadId != null ||
    thread.forkSourceThreadId != null ||
    thread.handoff != null
  ) {
    return null;
  }
  const undelivered = thread.messages.every(
    (message) =>
      message.role === "user" &&
      (message.source ?? "native") === "native" &&
      !message.turnId &&
      !message.streaming,
  );
  const latest = thread.messages.at(-1);
  // The resend path carries text; an attachment-only message keeps the handoff.
  return undelivered && latest && latest.text.trim().length > 0 ? latest : null;
}
