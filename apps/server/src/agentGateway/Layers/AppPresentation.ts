import { randomUUID } from "node:crypto";
import type { GladeAppOpenRequest } from "@glade/contracts/provider/agentGatewayTools";
import { Deferred, Effect, Layer, Queue, Semaphore, Stream } from "effect";
import { AppPresentation, type AppPresentationShape } from "../Services/AppPresentation";
import { ToolInputError } from "../toolInput";

export const AppPresentationLive = Layer.sync(AppPresentation, () => {
  const presentations = Semaphore.makeUnsafe(1);
  const clients = new Map<number, Queue.Queue<GladeAppOpenRequest>>();
  const pending = new Map<
    string,
    {
      clientId: number;
      queue: Queue.Queue<GladeAppOpenRequest>;
      done: Deferred.Deferred<void, ToolInputError>;
    }
  >();
  const open: AppPresentationShape["open"] = (request) =>
    Effect.gen(function* () {
      const client = [...clients.entries()].at(-1);
      if (!client) return yield* Effect.fail(new ToolInputError("No Glade UI is connected."));
      const [clientId, queue] = client;
      const requestId = randomUUID();
      const done = yield* Deferred.make<void, ToolInputError>();
      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          pending.set(requestId, { clientId, queue, done });
        }),
        () =>
          Queue.offer(queue, { ...request, requestId }).pipe(
            Effect.andThen(Deferred.await(done)),
            Effect.timeoutOrElse({
              duration: "10 seconds",
              onTimeout: () =>
                Effect.fail(
                  new ToolInputError("Glade UI did not confirm opening the requested view."),
                ),
            }),
          ),
        () =>
          Effect.sync(() => {
            pending.delete(requestId);
          }),
      );
    }).pipe(presentations.withPermit);
  const acknowledge: AppPresentationShape["acknowledge"] = (clientId, input) =>
    Effect.gen(function* () {
      const entry = pending.get(input.requestId);
      if (!entry || entry.clientId !== clientId) return false;
      return yield* input.error === undefined
        ? Deferred.succeed(entry.done, undefined)
        : Deferred.fail(entry.done, new ToolInputError(input.error));
    });
  const stream: AppPresentationShape["stream"] = (clientId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const queue = yield* Effect.acquireRelease(
          Queue.unbounded<GladeAppOpenRequest>(),
          (queue) =>
            Effect.gen(function* () {
              if (clients.get(clientId) === queue) clients.delete(clientId);
              for (const entry of pending.values())
                if (entry.queue === queue)
                  yield* Deferred.fail(
                    entry.done,
                    new ToolInputError("Glade UI disconnected before confirming the view."),
                  );
              yield* Queue.shutdown(queue);
            }),
        );
        clients.set(clientId, queue);
        return Stream.fromQueue(queue).pipe(
          Stream.filter((request) => pending.has(request.requestId)),
        );
      }),
    );
  return { open, acknowledge, stream } satisfies AppPresentationShape;
});
