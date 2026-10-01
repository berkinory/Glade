import { Effect, Option } from "effect";
import { assert } from "@effect/vitest";
import { ProviderService } from "../Services/ProviderService.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import { ProviderAdapterRequestError } from "../core/Errors.ts";
import { routing, asThreadId } from "./providerServiceTestFixtures.ts";

routing.layer("Native history ownership", (it) => {
  it.effect(
    "deletes only the bound native history after stopping its runtime, and retires failed deletes",
    () =>
      Effect.gen(function* () {
        const provider = yield* ProviderService;
        const directory = yield* ProviderSessionDirectory;
        const threadId = asThreadId("owned-native-delete");
        const nativeCursor = { threadId: "native-owned-session" };
        yield* provider.startSession(threadId, {
          threadId,
          provider: "codex",
          runtimeMode: "full-access",
          resumeCursor: nativeCursor,
        });
        routing.codex.updateNativeHistory.mockImplementationOnce((input) =>
          Effect.gen(function* () {
            assert.equal(yield* routing.codex.hasSession(threadId), false);
            assert.deepEqual(input.resumeCursor, nativeCursor);
            assert.deepEqual(input.action, { type: "delete" });
            return yield* new ProviderAdapterRequestError({
              provider: "codex",
              method: "thread/delete",
              detail: "native deletion rejected",
            });
          }),
        );
        const result = yield* Effect.result(
          provider.updateNativeHistory({ threadId, action: { type: "delete" } }),
        );
        assert.equal(result._tag, "Failure");
        assert.equal(Option.isNone(yield* directory.getBinding(threadId)), true);
        const calls = routing.codex.updateNativeHistory.mock.calls.length;
        yield* provider.updateNativeHistory({ threadId, action: { type: "delete" } });
        yield* provider.updateNativeHistory({
          threadId: asThreadId("unowned-session"),
          action: { type: "delete" },
        });
        assert.equal(routing.codex.updateNativeHistory.mock.calls.length, calls);
      }),
  );

  it.effect(
    "forwards Codex archive and unarchive without removing ownership, and leaves Claude history alone",
    () =>
      Effect.gen(function* () {
        const provider = yield* ProviderService;
        const directory = yield* ProviderSessionDirectory;
        for (const kind of ["codex", "claudeAgent"] as const) {
          const threadId = asThreadId(`archive-${kind}`);
          yield* provider.startSession(threadId, {
            threadId,
            provider: kind,
            runtimeMode: "full-access",
          });
          const adapter = kind === "codex" ? routing.codex : routing.claude;
          const before = adapter.updateNativeHistory.mock.calls.length;
          yield* provider.updateNativeHistory({ threadId, action: { type: "archive" } });
          yield* provider.updateNativeHistory({ threadId, action: { type: "unarchive" } });
          assert.equal(Option.isSome(yield* directory.getBinding(threadId)), true);
          assert.equal(
            adapter.updateNativeHistory.mock.calls.length - before,
            kind === "codex" ? 2 : 0,
          );
          if (kind === "codex")
            assert.deepEqual(
              adapter.updateNativeHistory.mock.calls
                .slice(before)
                .map(([input]) => input.action.type),
              ["archive", "unarchive"],
            );
        }
      }),
  );
});
