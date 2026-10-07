import type {
  ComputerDisplays,
  ComputerEncodedImage,
  ComputerUnavailableReason,
} from "@glade/contracts/computer/computerHost";
import { Data, ServiceMap, type Effect, type Stream } from "effect";

import type { CuaToolResult } from "../cuaResults.ts";

export class ComputerHostError extends Data.TaggedError("ComputerHostError")<{
  readonly code: "unavailable" | "timeout" | "cancelled" | "protocol";
  readonly message: string;
}> {}

export type ComputerStatus =
  | {
      readonly state: "ready";
      readonly generation: string;
      readonly driverVersion: string;
      readonly permissions: { readonly accessibility: boolean; readonly screenRecording: boolean };
      // Failing or warning health checks, as Cua's health_report names them.
      readonly healthProblems: ReadonlyArray<string>;
    }
  | {
      readonly state: "unavailable";
      readonly reason: ComputerUnavailableReason | "proxy_failed";
      readonly message: string;
    };

export interface ComputerHostShape {
  // False when the server does not run under the Glade desktop app; computer tools are not offered.
  readonly configured: boolean;
  readonly status: Stream.Stream<ComputerStatus>;
  readonly currentStatus: Effect.Effect<ComputerStatus>;
  // One Cua MCP tools/call on the current driver generation. Interruption cancels it in Cua. With
  // a thread, the call runs in that thread's own Cua session, so snapshots, zoom contexts and the
  // agent cursor of one thread never mix with another's.
  readonly callTool: (
    name: string,
    args: Readonly<Record<string, unknown>>,
    options: { readonly timeoutMs: number; readonly threadId?: string },
  ) => Effect.Effect<CuaToolResult, ComputerHostError>;
  // Ends the thread's Cua session, which releases held input and hides the agent cursor.
  readonly endSession: (threadId: string) => Effect.Effect<void>;
  readonly endAllSessions: Effect.Effect<void>;
  // Whole seconds since the user last touched the mouse or keyboard; null where the platform
  // cannot tell.
  readonly userIdleSeconds: Effect.Effect<number | null, ComputerHostError>;
  readonly displays: Effect.Effect<ComputerDisplays["displays"], ComputerHostError>;
  // One element per press of the desktop's Computer Use kill switch shortcut.
  readonly killSwitch: Stream.Stream<void>;
  readonly encodeJpeg: (png: string) => Effect.Effect<ComputerEncodedImage, ComputerHostError>;
}

export class ComputerHost extends ServiceMap.Service<ComputerHost, ComputerHostShape>()(
  "glade/computer/Services/ComputerHost",
) {}
