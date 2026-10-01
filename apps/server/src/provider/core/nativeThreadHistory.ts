import type { ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ProviderStartOptions } from "@glade/contracts/provider/sessionPolicy";

export type NativeThreadHistoryAction =
  | { readonly type: "delete" }
  | { readonly type: "archive" }
  | { readonly type: "unarchive" }
  | { readonly type: "rename"; readonly title: string };

export interface NativeThreadHistoryInput {
  readonly threadId: ThreadId;
  readonly action: NativeThreadHistoryAction;
  readonly resumeCursor: unknown;
  readonly cwd?: string | undefined;
  readonly providerOptions?: ProviderStartOptions | undefined;
}
