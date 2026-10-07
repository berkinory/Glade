import { Data, ServiceMap, type Effect, type Stream } from "effect";

export class DesktopHostError extends Data.TaggedError("DesktopHostError")<{
  // "unavailable", "timeout", "protocol", or the desktop's application failure code.
  readonly code: string;
  readonly message: string;
}> {}

export interface DesktopHostNotification {
  readonly method: string;
  readonly params: unknown;
}

export interface DesktopHostClientShape {
  // False when the server does not run under the Glade desktop app.
  readonly configured: boolean;
  readonly request: (
    method: string,
    params: unknown,
    timeoutMs: number,
  ) => Effect.Effect<unknown, DesktopHostError>;
  readonly notifications: Stream.Stream<DesktopHostNotification>;
}

export class DesktopHostClient extends ServiceMap.Service<
  DesktopHostClient,
  DesktopHostClientShape
>()("glade/desktopHost/Services/DesktopHostClient") {}
