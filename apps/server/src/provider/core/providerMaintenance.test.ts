import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { CLAUDE_PROVIDER_DESCRIPTOR } from "../claude/claudeProviderDescriptor";
import { CODEX_PROVIDER_DESCRIPTOR } from "../codex/codexProviderDescriptor";
import { CURSOR_PROVIDER_DESCRIPTOR } from "../cursor/cursorProviderDescriptor";
import { GROK_PROVIDER_DESCRIPTOR } from "../grok/grokProviderDescriptor";
import { OPENCODE_PROVIDER_DESCRIPTOR } from "../opencode/opencodeProviderDescriptor";
import type { ServerProviderDescriptor } from "./serverProviderDescriptor";
import { resolveProviderMaintenanceCapabilitiesEffect } from "./providerMaintenance";

describe("provider latest-version source", () => {
  it.each([
    {
      descriptor: CLAUDE_PROVIDER_DESCRIPTOR,
      path: "/Users/dev/.local/bin/claude",
      source: "url:https://downloads.claude.ai/claude-code-releases/latest",
    },
    {
      descriptor: CLAUDE_PROVIDER_DESCRIPTOR,
      path: "/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js",
      source: "npm:@anthropic-ai/claude-code",
    },
    {
      descriptor: CLAUDE_PROVIDER_DESCRIPTOR,
      path: "/opt/homebrew/Caskroom/claude-code/2.1.0/claude",
      source: "homebrew:claude-code",
    },
    {
      descriptor: CODEX_PROVIDER_DESCRIPTOR,
      path: "/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js",
      source: "npm:@openai/codex",
    },
    {
      descriptor: CURSOR_PROVIDER_DESCRIPTOR,
      path: "/Users/dev/.local/share/cursor-agent/versions/2026.10.01-e373342/cursor-agent",
      source: "url:https://cursor.com/install",
    },
    {
      descriptor: GROK_PROVIDER_DESCRIPTOR,
      path: "/Users/dev/.grok/bin/grok",
      source: "url:https://x.ai/cli/stable",
    },
    {
      descriptor: OPENCODE_PROVIDER_DESCRIPTOR,
      path: "/opt/homebrew/Cellar/opencode/2.0.28/bin/opencode",
      source: "homebrew:opencode",
    },
    {
      descriptor: OPENCODE_PROVIDER_DESCRIPTOR,
      path: "/Users/dev/.opencode/bin/opencode",
      source: "url:https://api.github.com/repos/anomalyco/opencode/releases/latest",
    },
  ])(
    "$descriptor.kind at $path tracks $source",
    async ({
      descriptor,
      path,
      source,
    }: {
      descriptor: ServerProviderDescriptor;
      path: string;
      source: string;
    }) => {
      const capabilities = await Effect.runPromise(
        resolveProviderMaintenanceCapabilitiesEffect(descriptor.maintenance, {
          binaryPath: path,
          realCommandPath: path,
        }).pipe(Effect.provide(NodeServices.layer)),
      );
      const latest = capabilities.latestVersionSource;
      expect(
        latest === null
          ? null
          : `${latest.kind}:${latest.kind === "url" ? latest.url : latest.name}`,
      ).toBe(source);
    },
  );
});
