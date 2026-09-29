import {
  ServerReadThreadDiagnosticsResult,
  type ServerReadThreadDiagnosticsInput,
} from "@glade/contracts";
import { Effect, Schema } from "effect";
import {
  makeThreadDiagnosticPageReaders,
  type ThreadDiagnosticPageDependencies,
} from "../agentGateway/threadDiagnosticTools.ts";

class ThreadDiagnosticError extends Error {
  readonly _tag = "ThreadDiagnosticError";
}

export function makeOwnerThreadDiagnosticReader(input: ThreadDiagnosticPageDependencies) {
  const readers = makeThreadDiagnosticPageReaders(input);
  return (
    request: ServerReadThreadDiagnosticsInput,
  ): Effect.Effect<ServerReadThreadDiagnosticsResult, Error> => {
    const { source, ...args } = request;
    if (
      (source === "events" && (args.turnId !== undefined || args.includeDetails !== undefined)) ||
      (source === "runtime" && args.payloadMode !== undefined)
    ) {
      return Effect.fail(
        new ThreadDiagnosticError("Diagnostic options do not match the requested source."),
      );
    }
    const reader = source === "events" ? readers.readEvents : readers.readRuntimeEvents;
    return Effect.suspend(() => reader.handler(args)).pipe(
      Effect.catchDefect(() =>
        Effect.fail(new ThreadDiagnosticError("Thread diagnostic request was refused.")),
      ),
      Effect.mapError(() => new ThreadDiagnosticError("Thread diagnostic request was refused.")),
      Effect.flatMap((result) => {
        const content = result.content[0];
        if (result.isError || result.content.length !== 1 || content?.type !== "text") {
          return Effect.fail(new ThreadDiagnosticError("Thread diagnostic request was refused."));
        }
        return Effect.try({
          try: () =>
            Schema.decodeUnknownSync(ServerReadThreadDiagnosticsResult)(JSON.parse(content.text)),
          catch: () => new ThreadDiagnosticError("Thread diagnostic response was invalid."),
        });
      }),
    );
  };
}
