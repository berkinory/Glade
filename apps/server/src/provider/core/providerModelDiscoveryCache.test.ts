import type { ProviderListModelsResult } from "@glade/contracts/provider/providerDiscovery";
import { Deferred, Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  makeProviderModelDiscoveryCache,
  type PersistedModelCatalogEntryInput,
  type ProviderModelDiscoveryCacheKey,
} from "./providerModelDiscoveryCache";

const globalKey: ProviderModelDiscoveryCacheKey = {
  provider: "codex",
  binaryPath: "/bin/codex",
  apiEndpoint: null,
  cwd: null,
  contextIdentity: "account-a",
};
const catalog = (slug: string): ProviderListModelsResult => ({
  models: [{ slug, name: slug }],
  source: "codex-app-server",
});

describe("model catalog reuse", () => {
  it("serves a persisted account catalog during coalesced project discovery and preserves project differences", async () => {
    let persisted: ReadonlyArray<PersistedModelCatalogEntryInput> = [];
    const first = makeProviderModelDiscoveryCache<never>({
      onCatalogsChanged: (entries) => {
        persisted = entries;
      },
    });
    await Effect.runPromise(first.lookup(globalKey, Effect.succeed(catalog("global"))));
    const cache = makeProviderModelDiscoveryCache<never>({ persistedCatalogs: persisted });
    const projectKey = { ...globalKey, cwd: "/project", workspaceIdentity: "project-config" };
    const gate = await Effect.runPromise(Deferred.make<ProviderListModelsResult>());
    let calls = 0;
    const discover = Effect.gen(function* () {
      calls++;
      return yield* Deferred.await(gate);
    });
    const results = await Promise.all([
      Effect.runPromise(cache.lookup(projectKey, discover)),
      Effect.runPromise(cache.lookup(projectKey, discover)),
    ]);
    expect(results.map((result) => [result.models[0]?.slug, result.stale])).toEqual([
      ["global", true],
      ["global", true],
    ]);
    await vi.waitFor(() => expect(calls).toBe(1));
    await Effect.runPromise(Deferred.succeed(gate, catalog("project")));
    await vi.waitFor(async () => {
      const fresh = await Effect.runPromise(cache.lookup(projectKey, discover));
      expect([fresh.models[0]?.slug, fresh.stale]).toEqual(["project", false]);
    });
    const scratchKey = { ...globalKey, cwd: "/scratch/new-chat" };
    const scratch = await Effect.runPromise(
      cache.lookup(scratchKey, Effect.succeed(catalog("global"))),
    );
    expect([scratch.models[0]?.slug, scratch.stale]).toEqual(["global", true]);
    await vi.waitFor(async () => {
      expect(
        (await Effect.runPromise(cache.lookup(scratchKey, Effect.succeed(catalog("global")))))
          .stale,
      ).toBe(false);
    });
  });

  it("waits for discovery on an account change instead of exposing another account's saved models", async () => {
    const cache = makeProviderModelDiscoveryCache<never>();
    await Effect.runPromise(cache.lookup(globalKey, Effect.succeed(catalog("private-a"))));
    const accountB = { ...globalKey, contextIdentity: "account-b", cwd: "/scratch/new-chat" };
    const gate = await Effect.runPromise(Deferred.make<ProviderListModelsResult>());
    const started = await Effect.runPromise(Deferred.make<void>());
    const discover = Effect.gen(function* () {
      yield* Deferred.succeed(started, undefined);
      return yield* Deferred.await(gate);
    });
    let settled = false;
    const result = Effect.runPromise(cache.lookup(accountB, discover)).then((value) => {
      settled = true;
      return value;
    });
    await Effect.runPromise(Deferred.await(started));
    expect(settled).toBe(false);
    await Effect.runPromise(Deferred.succeed(gate, catalog("private-b")));
    expect((await result).models.map((model) => model.slug)).toEqual(["private-b"]);
  });
});
