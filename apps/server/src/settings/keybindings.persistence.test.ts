import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import type { KeybindingRule } from "@glade/contracts/settings/keybindings";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { deriveServerPaths, ServerConfig } from "../server/config";
import { Keybindings } from "./Services/Keybindings";
import { KeybindingsLive } from "./Layers/Keybindings";

describe("keybindings persistence", () => {
  it("preserves sibling conditional overrides when editing a rule and restarting the service", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "glade-keybindings-persistence-"));
    try {
      const paths = await Effect.runPromise(
        deriveServerPaths(directory, undefined).pipe(Effect.provide(NodeServices.layer)),
      );
      const initial: KeybindingRule = {
        key: "mod+shift+k",
        command: "sidebar.toggle",
        when: "terminalFocus",
      };
      const sibling: KeybindingRule = {
        key: "mod+shift+l",
        command: "sidebar.toggle",
        when: "!terminalFocus",
      };
      const replacement: KeybindingRule = { ...initial, key: "mod+shift+j" };
      await fs.mkdir(path.dirname(paths.keybindingsConfigPath), { recursive: true });
      await fs.writeFile(paths.keybindingsConfigPath, JSON.stringify([initial, sibling]));

      const runtimeLayer = KeybindingsLive.pipe(
        Layer.provide(ServerConfig.layerTest(os.tmpdir(), directory)),
        Layer.provide(NodeServices.layer),
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const keybindings = yield* Keybindings;
          yield* keybindings.start;
          yield* keybindings.upsertKeybindingRule(replacement, initial);
        }).pipe(Effect.provide(runtimeLayer)),
      );

      const persisted = JSON.parse(
        await fs.readFile(paths.keybindingsConfigPath, "utf8"),
      ) as KeybindingRule[];
      expect(persisted.filter((rule) => rule.command === "sidebar.toggle")).toEqual([
        sibling,
        replacement,
      ]);

      const restarted = await Effect.runPromise(
        Effect.gen(function* () {
          const keybindings = yield* Keybindings;
          yield* keybindings.start;
          return yield* keybindings.getSnapshot;
        }).pipe(Effect.provide(runtimeLayer)),
      );
      const overrides = restarted.keybindings.filter((rule) => rule.command === "sidebar.toggle");
      expect(overrides.map((rule) => rule.shortcut.key).toSorted()).toEqual(["j", "l"]);
      expect(overrides.find((rule) => rule.shortcut.key === "l")?.whenAst).toEqual({
        type: "not",
        node: { type: "identifier", name: "terminalFocus" },
      });
      expect(restarted.issues).toEqual([]);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
