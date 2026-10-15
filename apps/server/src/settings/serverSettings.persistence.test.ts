import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { deriveServerPaths, ServerConfig } from "../server/config";
import { ServerSettingsLive, ServerSettingsService } from "./serverSettings";

describe("server settings persistence", () => {
  it("keeps every setting when the file is invalid while the running server saves a change", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "glade-server-settings-"));
    try {
      const { settingsPath } = await Effect.runPromise(
        deriveServerPaths(directory, undefined).pipe(Effect.provide(NodeServices.layer)),
      );
      await fs.mkdir(path.dirname(settingsPath), { recursive: true });
      await fs.writeFile(
        settingsPath,
        JSON.stringify({ settings: { enableAssistantStreaming: false, keepDisplayAwake: true } }),
      );
      const layer = ServerSettingsLive.pipe(
        Layer.provide(ServerConfig.layerTest(os.tmpdir(), directory)),
        Layer.provide(NodeServices.layer),
      );

      const saved = await Effect.runPromise(
        Effect.gen(function* () {
          const settings = yield* ServerSettingsService;
          yield* settings.start;
          yield* Effect.promise(() => fs.writeFile(settingsPath, '{"settings": {'));
          return yield* settings.updateSettings({ keepAwakeMode: "agent" });
        }).pipe(Effect.scoped, Effect.provide(layer)),
      );

      expect(saved).toMatchObject({
        enableAssistantStreaming: false,
        keepDisplayAwake: true,
        keepAwakeMode: "agent",
      });
      const persisted = JSON.parse(await fs.readFile(settingsPath, "utf8")) as {
        settings: Record<string, unknown>;
      };
      expect(persisted.settings).toMatchObject({
        enableAssistantStreaming: false,
        keepDisplayAwake: true,
        keepAwakeMode: "agent",
      });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
