import { Effect } from "effect";
import { ProviderService } from "../Services/ProviderService.ts";
import { assert } from "@effect/vitest";
import { makeProviderServiceLayer, asThreadId } from "./providerServiceTestFixtures";

const validation = makeProviderServiceLayer();

validation.layer("ProviderServiceLive validation", (it) => {
  it.effect("fails closed when startSession has no provider source", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const threadId = asThreadId("thread-no-provider");

      const failure = yield* Effect.result(
        provider.startSession(threadId, {
          threadId,
          runtimeMode: "full-access",
        }),
      );

      assert.equal(failure._tag, "Failure");
      if (failure._tag !== "Failure") return;
      assert.equal(failure.failure._tag, "ProviderValidationError");
      if (failure.failure._tag !== "ProviderValidationError") return;
      assert.equal(failure.failure.operation, "provider.session.start");
    }),
  );
});

const disabledProviderStart = makeProviderServiceLayer({
  providerIsEnabled: (provider) => Effect.succeed(provider !== "codex"),
});

disabledProviderStart.layer("ProviderServiceLive enablement", (it) => {
  it.effect("rejects native imports for disabled providers before touching the source", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const result = yield* Effect.result(
        provider.importExternalThread!({
          threadId: asThreadId("disabled-import"),
          provider: "codex",
          externalThreadId: "source",
          sourceCwd: "/repo/source",
          modelSelection: { provider: "codex", model: "gpt-5.4" },
          runtimeMode: "full-access",
        }),
      );
      assert.equal(result._tag, "Failure");
      assert.equal(disabledProviderStart.codex.forkThread.mock.calls.length, 0);
    }),
  );
});

let providerEnabledDuringStart = true;

const providerDisabledAfterInitialCheck = makeProviderServiceLayer({
  providerIsEnabled: () =>
    Effect.sync(() => {
      const enabled = providerEnabledDuringStart;
      providerEnabledDuringStart = false;
      return enabled;
    }),
});

providerDisabledAfterInitialCheck.layer("ProviderServiceLive enablement race", (it) => {
  it.effect("rechecks provider enablement immediately before adapter startup", () =>
    Effect.gen(function* () {
      providerEnabledDuringStart = true;
      providerDisabledAfterInitialCheck.codex.startSession.mockClear();
      const provider = yield* ProviderService;
      const threadId = asThreadId("thread-disabled-during-start");

      const failure = yield* Effect.result(
        provider.startSession(threadId, {
          provider: "codex",
          threadId,
          runtimeMode: "full-access",
        }),
      );

      assert.equal(failure._tag, "Failure");
      if (failure._tag !== "Failure") return;
      assert.equal(failure.failure._tag, "ProviderValidationError");
      assert.equal(failure.failure.message.includes("disabled"), true);
      assert.equal(providerDisabledAfterInitialCheck.codex.startSession.mock.calls.length, 0);
    }),
  );
});
