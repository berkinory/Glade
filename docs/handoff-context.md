# Provider handoff context

Provider handoff continues in the same chat. Picking a model from another provider switches the chat's selection immediately and records a pending transition; nothing is stopped, prepared or sent until the next message. Choosing the original provider again, or **Switch back** on the transition divider, undoes a pending switch. Changing models within one provider uses the ordinary model-change path. A chat whose sends never reached a provider switches directly and resends its latest message instead.

## Delivery

The next message delivers the transition:

1. The bound session is stopped. A session of the source provider is **parked**: its native resume cursor and the newest chat message it had seen are kept per thread and provider (`provider_parked_sessions`). Anything else bound there, such as a destination left by a failed delivery, is discarded.
2. If the destination has a parked session whose last seen message still exists, it resumes that native conversation and receives only the items after that message (**resumed**). A rollback that removed the message, a missing cursor, or a resume that falls back to a new native thread starts fresh with the full history (**fresh**).
3. Codex receives the history through `thread/inject_items` as model-visible items. An app server without the method (`-32601`) falls back to an inline `<handoff_context>` block before the message; any other injection error fails the send rather than risk delivering twice. Claude always receives the inline block.
4. Native acceptance of the first turn marks the transition delivered. A failure before acceptance keeps it pending and retryable by sending again; a retry always starts fresh. An ambiguous send failure marks it uncertain, which blocks further switches until it is dismissed.

Deleting or archiving a chat applies to its parked native sessions as well.

## History selection

There is no model summarization. History is a deterministic, budgeted selection of whole items: user and assistant messages, completed tool calls with their recorded detail, and runtime errors. The latest request, the latest reply and the original request are kept first, then items fill from newest to oldest. Items that do not fit are omitted whole, never clipped. The header states the coverage, how many items were selected and omitted, that history is context rather than a new instruction, and how to page the rest with `glade_read_thread` and `glade_read_thread_activity`.

The budget is the smaller of 32,000 UTF-8 bytes and the space left in the provider input after the new message. Native runtimes expose no portable tokenizer, so bytes stand in for tokens. The same selection rebuilds context when a session restarts without its native history.

## Inspection

Each transition has one divider in the transcript, updated in place: switching, continued or resumed, cancelled, or needs review. Its details show the source and destination selections, strategy, delivery channel, selected and omitted counts, the redacted context that was delivered and any failure.
