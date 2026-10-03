import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer, ManagedRuntime } from "effect";
import { expect, it } from "vitest";
import { ServerConfig } from "../../server/config";
import { ServerSettingsLive, ServerSettingsService } from "../../settings/serverSettings";
import { layer as NodePtyLive } from "../../terminal/Layers/NodePTY";
import { ProviderAuthentication } from "../Services/ProviderAuthentication";
import { ProviderAuthenticationLive } from "./ProviderAuthentication";

it.skipIf(process.platform === "win32").each(["claudeAgent", "codex"] as const)(
  "owns one transient %s attempt, fences stale attachments and stops a live process",
  async (provider) => {
    const config = Layer.effect(
      ServerConfig,
      Effect.gen(function* () {
        const base = yield* ServerConfig;
        return { ...base, homeDir: base.baseDir };
      }),
    ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "glade-auth-" })));
    const runtime = ManagedRuntime.make(
      ProviderAuthenticationLive.pipe(
        Layer.provideMerge(ServerSettingsLive),
        Layer.provide(NodePtyLive),
        Layer.provideMerge(config),
        Layer.provideMerge(NodeServices.layer),
      ),
    );
    try {
      const service = await runtime.runPromise(Effect.service(ProviderAuthentication));
      const settings = await runtime.runPromise(Effect.service(ServerSettingsService));
      const root = await runtime.runPromise(
        Effect.map(Effect.service(ServerConfig), (config) => config.baseDir),
      );
      const fs = await runtime.runPromise(Effect.service(FileSystem.FileSystem));
      const logs = await runtime.runPromise(
        Effect.map(Effect.service(ServerConfig), (config) => config.terminalLogsDir),
      );
      await runtime.runPromise(fs.makeDirectory(logs, { recursive: true }));
      const binaryPath = `${root}/claude-fixture`;
      await runtime.runPromise(
        fs.writeFileString(
          binaryPath,
          '#!/bin/sh\nprintf "AUTH_READY:%s:%s\\n" "$1" "$2"\nread value\nprintf "AUTH_DONE\\n"\n',
        ),
      );
      await runtime.runPromise(fs.chmod(binaryPath, 0o700));
      await runtime.runPromise(
        settings.updateSettings({
          providers: {
            [provider]: { binaryPath, ...(provider === "codex" ? { homePath: root } : {}) },
          },
        }),
      );
      const first = await runtime.runPromise(service.request({ provider, action: "start" }));
      expect(first).toMatchObject({ status: "running", executable: binaryPath });
      const repeated = await runtime.runPromise(service.request({ provider, action: "start" }));
      expect(repeated?.id).toBe(first?.id);
      await expect
        .poll(
          async () =>
            (await runtime.runPromise(service.request({ provider, action: "status" })))?.output,
        )
        .toContain(provider === "claudeAgent" ? "AUTH_READY:auth:login" : "AUTH_READY:login:");
      await runtime.runPromise(
        service.request({
          provider,
          action: "write",
          id: first!.id,
          data: "finish\n",
        }),
      );
      await expect
        .poll(
          async () =>
            (await runtime.runPromise(service.request({ provider, action: "status" })))?.status,
        )
        .toBe("exited");
      expect(
        await runtime.runPromise(service.request({ provider, action: "start" })),
      ).toMatchObject({ id: first!.id, status: "exited", exitCode: 0 });
      await runtime.runPromise(service.request({ provider, action: "close", id: first!.id }));
      const second = await runtime.runPromise(service.request({ provider, action: "start" }));
      await expect(
        runtime.runPromise(service.request({ provider, action: "close", id: first!.id })),
      ).rejects.toThrow("no longer attached");
      expect(
        await runtime.runPromise(service.request({ provider, action: "status" })),
      ).toMatchObject({ id: second!.id, status: "running" });
      await runtime.runPromise(service.request({ provider, action: "close", id: second!.id }));
      expect(await runtime.runPromise(service.request({ provider, action: "status" }))).toBeNull();
      expect(await runtime.runPromise(fs.readDirectory(logs))).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  },
);
