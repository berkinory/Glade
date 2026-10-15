import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { describe, expect, it } from "vitest";

import { formatProviderScopedModelName } from "./providerModelOptions";

describe("formatProviderScopedModelName", () => {
  const cases: ReadonlyArray<{
    case: string;
    provider: ProviderKind;
    name: string;
    catalog?: ReadonlyArray<string>;
    expected: string;
  }> = [
    {
      case: "drops the provider name",
      provider: "claudeAgent",
      name: "Claude Opus 5",
      expected: "Opus 5",
    },
    {
      case: "handles an unknown future model",
      provider: "claudeAgent",
      name: "Claude Zephyr 9 Mini",
      expected: "Zephyr 9 Mini",
    },
    {
      case: "ignores case and extra spacing",
      provider: "grok",
      name: "grok  Code Fast 2",
      expected: "Code Fast 2",
    },
    {
      case: "keeps a name without the prefix",
      provider: "claudeAgent",
      name: "Fable",
      expected: "Fable",
    },
    {
      case: "keeps a model family that is not the provider name",
      provider: "codex",
      name: "GPT-5.5",
      expected: "GPT-5.5",
    },
    {
      case: "keeps a gateway's vendor names",
      provider: "cursor",
      name: "Claude 4 Sonnet",
      expected: "Claude 4 Sonnet",
    },
    {
      case: "keeps a prefix-only name",
      provider: "claudeAgent",
      name: "Claude",
      expected: "Claude",
    },
    {
      case: "keeps a name left as a bare version",
      provider: "grok",
      name: "Grok 4.1 Fast",
      expected: "Grok 4.1 Fast",
    },
    {
      case: "keeps a name left as a parenthetical",
      provider: "claudeAgent",
      name: "Claude (default)",
      expected: "Claude (default)",
    },
    {
      case: "needs a word boundary",
      provider: "codex",
      name: "Codexify Pro",
      expected: "Codexify Pro",
    },
    {
      case: "needs a space after the prefix",
      provider: "claudeAgent",
      name: "claude-opus-5",
      expected: "claude-opus-5",
    },
    {
      case: "keeps the full name when another model already reads the same",
      provider: "claudeAgent",
      name: "Claude Fable 5",
      catalog: ["Claude Fable 5", "fable 5"],
      expected: "Claude Fable 5",
    },
    {
      case: "keeps the full name when two models would shorten alike",
      provider: "claudeAgent",
      name: "Claude Opus 5",
      catalog: ["Claude Opus 5", "claude opus 5"],
      expected: "Claude Opus 5",
    },
    {
      case: "shortens when catalog neighbours differ",
      provider: "claudeAgent",
      name: "Claude Fable 5",
      catalog: ["Claude Fable 5", "Fable", "Claude Opus 5"],
      expected: "Fable 5",
    },
  ];

  it.each(cases)("$case", ({ provider, name, catalog, expected }) => {
    expect(formatProviderScopedModelName(provider, name, catalog ?? [name])).toBe(expected);
  });
});
