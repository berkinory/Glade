import * as NodeSink from "@effect/platform-node/NodeSink";
import { Data, Effect, Fiber, Stream } from "effect";
import { Writable, type WritableOptions } from "node:stream";
import { describe, expect, it } from "vitest";

const epipe = () => Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));
const observeError = () => {};

class SinkWriteError extends Data.TaggedError("SinkWriteError")<{ readonly cause: unknown }> {}

const observedWritable = (options: WritableOptions) => {
  const writable = new Writable(options);
  // Keeps an unpatched runtime's unhandled "error" from crashing the runner.
  writable.on("error", observeError);
  return writable;
};

const run = (stream: Stream.Stream<string>, writable: Writable, endOnDone?: boolean) =>
  Stream.run(
    stream,
    NodeSink.fromWritable({
      evaluate: () => writable,
      onError: (cause) => new SinkWriteError({ cause }),
      endOnDone,
    }),
  );

const runToFailure = (stream: Stream.Stream<string>, writable: Writable, endOnDone?: boolean) =>
  Effect.runPromise(
    run(stream, writable, endOnDone).pipe(
      Effect.timeout("250 millis"),
      Effect.flip,
      Effect.map((error) => (error instanceof SinkWriteError ? error.cause : error)),
    ),
  );

const expectOnlyObserverLeft = (writable: Writable) => {
  expect(writable.listeners("error")).toEqual([observeError]);
  expect(writable.listenerCount("drain")).toBe(0);
  expect(writable.listenerCount("finish")).toBe(0);
};

describe("Effect writable sink", () => {
  it.each([1, 1024])(
    "fails on an asynchronous EPIPE at highWaterMark=%i",
    async (highWaterMark) => {
      const failure = epipe();
      const writable = observedWritable({
        highWaterMark,
        write: (_chunk, _encoding, callback) => setImmediate(() => callback(failure)),
      });
      expect(await runToFailure(Stream.make("chunk"), writable, false)).toBe(failure);
      expectOnlyObserverLeft(writable);
    },
  );

  it("waits for accepted asynchronous writes without ending a shared stream", async () => {
    const written: string[] = [];
    const writable = new Writable({
      write: (chunk, _encoding, callback) =>
        setImmediate(() => {
          written.push(String(chunk));
          callback();
        }),
    });
    await Effect.runPromise(run(Stream.make("first", "second"), writable, false));
    expect(written).toEqual(["first", "second"]);
    expect(writable.writableEnded).toBe(false);
    expect(writable.listenerCount("error")).toBe(0);
    expect(writable.listenerCount("close")).toBe(0);
    writable.destroy();
  });

  it.each([
    { name: "with an error", destroyWith: epipe(), code: "EPIPE" },
    { name: "without an error", destroyWith: undefined, code: "ERR_STREAM_PREMATURE_CLOSE" },
  ])("fails when the pipe closes $name while waiting for input", async ({ destroyWith, code }) => {
    const writable = observedWritable({ write: (_chunk, _encoding, callback) => callback() });
    const failing = runToFailure(Stream.never, writable, false);
    await nextTurn();
    writable.destroy(destroyWith);
    expect(await failing).toMatchObject({ code });
  });

  it("fails when ending the stream fails", async () => {
    const failure = epipe();
    const writable = observedWritable({
      write: (_chunk, _encoding, callback) => callback(),
      final: (callback) => setImmediate(() => callback(failure)),
    });
    expect(await runToFailure(Stream.make("chunk"), writable)).toBe(failure);
    expectOnlyObserverLeft(writable);
  });

  it.each([
    { name: "write", endOnDone: false },
    { name: "end", endOnDone: true },
  ])("keeps a pending $name's error handled after cancellation", async ({ endOnDone }) => {
    let settle: ((error?: Error | null) => void) | undefined;
    const writable = observedWritable({
      highWaterMark: 1,
      write: (_chunk, _encoding, callback) => (endOnDone ? callback() : (settle = callback)),
      final: (callback) => (settle = callback),
    });
    const fiber = Effect.runFork(run(Stream.make("chunk"), writable, endOnDone));
    await nextTurn();
    expect(settle).toBeDefined();
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(writable.listenerCount("drain")).toBe(0);
    expect(writable.listenerCount("finish")).toBe(0);
    expect(writable.listenerCount("error")).toBe(2);
    settle!(epipe());
    await nextTurn();
    expectOnlyObserverLeft(writable);
  });
});
