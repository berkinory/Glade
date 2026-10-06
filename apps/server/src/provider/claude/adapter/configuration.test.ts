import { describe, it, assert } from "@effect/vitest";
import { GLADE_HARNESS_POLICY_MARKER } from "../../../agentGateway/harnessPolicy.ts";
import { Effect, Random, Layer, Exit } from "effect";
import { ClaudeAdapter } from "../../Services/ClaudeAdapter.ts";
import { makeClaudeAdapterLive as makeClaudeAdapterLiveBase } from "../../Layers/ClaudeAdapter.ts";
import { ServerConfig } from "../../../server/config.ts";
import { ServerSettingsService } from "../../../settings/serverSettings.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  makeHarness,
  THREAD_ID,
  makeDeterministicRandomService,
  FakeClaudeQuery,
  makeClaudeAdapterLive,
} from "./adapterTestFixtures";

describe("Claude configuration", () => {
  it.effect("derives bypass permission mode from full-access runtime policy", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "full-access",
      });

      const createInput = harness.getLastCreateQueryInput();
      assert.deepEqual(createInput?.options.settingSources, ["user", "project", "local"]);
      assert.equal(createInput?.options.permissionMode, "bypassPermissions");
      assert.equal(createInput?.options.allowDangerouslySkipPermissions, true);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("rejects Auto on an unsupported selected Claude binary before session startup", () => {
    const query = new FakeClaudeQuery();
    let createQueryCalls = 0;
    const layer = makeClaudeAdapterLiveBase({
      readClaudeCliVersion: async ({ binaryPath }) => {
        assert.equal(binaryPath, "/custom/bin/claude");
        return "2.1.110";
      },
      createQuery: () => {
        createQueryCalls += 1;
        return query;
      },
    }).pipe(
      Layer.provide(ServerSettingsService.layerTest()),
      Layer.provideMerge(ServerConfig.layerTest("/tmp/claude-adapter-test", "/tmp")),
      Layer.provideMerge(NodeServices.layer),
    );

    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const result = yield* Effect.exit(
        adapter.startSession({
          threadId: THREAD_ID,
          provider: "claudeAgent",
          runtimeMode: "auto",
          providerOptions: {
            claudeAgent: {
              binaryPath: "/custom/bin/claude",
            },
          },
        }),
      );

      assert.ok(Exit.isFailure(result));
      assert.equal(createQueryCalls, 0);
      assert.equal(yield* adapter.hasSession(THREAD_ID), false);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(layer),
    );
  });

  it.effect("loads Claude filesystem settings sources for SDK sessions", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "approval-required",
      });

      const createInput = harness.getLastCreateQueryInput();
      assert.deepEqual(createInput?.options.settingSources, ["user", "project", "local"]);
      assert.equal(createInput?.options.permissionMode, undefined);
      assert.equal(createInput?.options.allowDangerouslySkipPermissions, undefined);
      const systemPrompt = createInput?.options.systemPrompt;
      if (
        systemPrompt === undefined ||
        typeof systemPrompt === "string" ||
        Array.isArray(systemPrompt) ||
        systemPrompt.type !== "preset"
      ) {
        return assert.fail("Expected Claude preset system prompt.");
      }
      assert.equal(systemPrompt.preset, "claude_code");
      assert.equal(systemPrompt.excludeDynamicSections, true);
      assert.include(systemPrompt.append ?? "", GLADE_HARNESS_POLICY_MARKER);
      assert.include(systemPrompt.append ?? "", "Glade is the host application");

      assert.include(systemPrompt.append ?? "", "Glade MCP control is unavailable");
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(harness.layer),
    );
  });

  it.effect("discovers Claude model capabilities before a session starts", () => {
    const query = new FakeClaudeQuery();
    let createQueryCalls = 0;
    (
      query as unknown as {
        supportedModels: () => Promise<
          Array<{
            value: string;
            resolvedModel: string;
            displayName: string;
            description: string;
            supportsAutoMode: boolean;
          }>
        >;
      }
    ).supportedModels = async () => {
      assert.ok(query.iteratorNextCalls > 0, "model discovery must drive the SDK handshake");
      return [
        {
          value: "claude-fable-5[1m]",
          resolvedModel: "claude-fable-5[1m]",
          displayName: "Fable",
          description: "Claude Fable 5",
          supportsAutoMode: true,
        },
      ];
    };
    const layer = makeClaudeAdapterLive({
      createQuery: () => {
        createQueryCalls += 1;
        return query;
      },
    }).pipe(
      Layer.provideMerge(ServerConfig.layerTest("/tmp/claude-adapter-test", "/tmp")),
      Layer.provideMerge(NodeServices.layer),
    );

    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const listModels = adapter.listModels;
      if (!listModels) {
        assert.fail("Expected Claude adapter to support model discovery.");
      }

      const discovered = yield* listModels({
        provider: "claudeAgent",
        cwd: "/tmp/project",
      });
      assert.equal(discovered.source, "sdk");
      assert.equal(discovered.cached, false);
      assert.lengthOf(discovered.models, 1);
      const { optionDescriptors, ...model } = discovered.models[0]!;
      assert.deepEqual(model, {
        slug: "claude-fable-5[1m]",
        resolvedModel: "claude-fable-5[1m]",
        name: "Fable",
        description: "Claude Fable 5",
        supportsAutoMode: true,
      });
      assert.isUndefined(optionDescriptors);
      assert.equal(query.closeCalls, 1);
      assert.equal(createQueryCalls, 1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("listSkills uses the configured Claude binary", () => {
    const executables: Array<string | undefined> = [];
    const layer = makeClaudeAdapterLive({
      createQuery: (input) => {
        executables.push(input.options.pathToClaudeCodeExecutable);
        return new FakeClaudeQuery();
      },
    }).pipe(
      Layer.provideMerge(ServerConfig.layerTest("/tmp/claude-adapter-test", "/tmp")),
      Layer.provideMerge(NodeServices.layer),
    );

    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const listSkills = adapter.listSkills;
      if (!listSkills) {
        assert.fail("Expected Claude adapter to support skill discovery.");
      }
      const request = { provider: "claudeAgent", cwd: "/tmp/project" } as const;
      const runtime = { binaryPath: "/custom/bin/claude", identity: "account-a" };

      yield* listSkills(request, runtime);
      yield* listSkills(request, runtime);
      assert.deepEqual(executables, ["/custom/bin/claude"]);

      yield* listSkills(request, { ...runtime, identity: "account-b" });
      assert.deepEqual(executables, ["/custom/bin/claude", "/custom/bin/claude"]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("rejects unsupported live model switches before changing an Auto session", () => {
    const query = new FakeClaudeQuery();
    (
      query as unknown as {
        supportedModels: () => Promise<
          Array<{ value: string; displayName: string; supportsAutoMode: boolean }>
        >;
      }
    ).supportedModels = async () => [
      {
        value: "claude-opus-4-6",
        displayName: "Claude Opus 4.6",
        supportsAutoMode: true,
      },
      {
        value: "claude-haiku-4-5",
        displayName: "Claude Haiku 4.5",
        supportsAutoMode: false,
      },
      {
        value: "claude-fable-5",
        displayName: "Claude Fable 5",
        supportsAutoMode: true,
      },
    ];
    const layer = makeClaudeAdapterLive({ createQuery: () => query }).pipe(
      Layer.provideMerge(ServerConfig.layerTest("/tmp/claude-adapter-test", "/tmp")),
      Layer.provideMerge(NodeServices.layer),
    );

    return Effect.gen(function* () {
      const adapter = yield* ClaudeAdapter;
      const session = yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "claudeAgent",
        runtimeMode: "auto",
        modelSelection: {
          provider: "claudeAgent",
          model: "claude-opus-4-6",
        },
      });

      const unsupportedSwitch = yield* Effect.exit(
        adapter.sendTurn({
          threadId: session.threadId,
          input: "switch to Haiku",
          modelSelection: {
            provider: "claudeAgent",
            model: "claude-haiku-4-5",
          },
          attachments: [],
        }),
      );

      assert.ok(Exit.isFailure(unsupportedSwitch));
      assert.deepEqual(query.setModelCalls, []);

      yield* adapter.sendTurn({
        threadId: session.threadId,
        input: "switch to Fable",
        modelSelection: {
          provider: "claudeAgent",
          model: "claude-fable-5",
        },
        attachments: [],
      });
      assert.deepEqual(query.setModelCalls, ["claude-fable-5"]);
    }).pipe(
      Effect.provideService(Random.Random, makeDeterministicRandomService()),
      Effect.provide(layer),
    );
  });
});
