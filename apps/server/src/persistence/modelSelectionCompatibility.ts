import { DEFAULT_MODEL_BY_PROVIDER } from "@glade/contracts/provider/model";
import { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { type ModelSelection } from "@glade/contracts/orchestration/orchestration";

const retiredProviderIds = new Set([
  "antigravity",
  "devin",
  "droid",
  "omp",
  "pi",
  "gemini",
  "cursor",
  "grok",
  "opencode",
  "kilo",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTrimmedString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeOptions(
  value: unknown,
  provider: ProviderKind,
  originalProvider: unknown,
): unknown {
  if (Array.isArray(value)) {
    const entries: Array<readonly [string, unknown]> = [];
    for (const item of value) {
      if (!isRecord(item)) return value;
      const id = readTrimmedString(item, "id");
      if (!id) return value;
      entries.push([id, item.value]);
    }
    return Object.fromEntries(entries);
  }
  if (!isRecord(value)) return value;
  const scoped =
    value[provider] ?? (typeof originalProvider === "string" ? value[originalProvider] : undefined);
  return scoped === undefined ? value : normalizeOptions(scoped, provider, originalProvider);
}

function inferProvider(raw: unknown, model: string): ProviderKind | null {
  if (typeof raw === "string") {
    if (retiredProviderIds.has(raw.toLowerCase())) return null;
    if (ProviderKind.literals.includes(raw as ProviderKind)) return raw as ProviderKind;
    const label = raw.toLowerCase();
    if (
      /\b(oh my pi|omp|pi|devin|windsurf|cognition|droid|factory|antigravity|gemini)\b/u.test(label)
    )
      return null;
    if (label.includes("claude") || label.includes("anthropic")) return "claudeAgent";
    if (label.includes("codex")) return "codex";
  }
  const lowerModel = model.toLowerCase();
  if (lowerModel.includes("gemini") || lowerModel.includes("devin")) return null;
  if (lowerModel.includes("claude")) return "claudeAgent";
  return "codex";
}

export function normalizeLegacyModelSelection(input: {
  readonly provider: unknown;
  readonly model: string;
  readonly options: unknown;
}): Record<string, unknown> {
  const provider = inferProvider(input.provider, input.model);
  // Retired selections cannot be resumed safely. Project/thread projections use a valid default while
  // the original provider/model remain in the event journal.
  if (provider === null) {
    return { provider: "codex", model: DEFAULT_MODEL_BY_PROVIDER.codex } satisfies ModelSelection;
  }
  const options = normalizeOptions(input.options, provider, input.provider);
  return {
    provider,
    model: input.model,
    ...(options === undefined ? {} : { options }),
  };
}

export function normalizePersistedModelSelection(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const model = readTrimmedString(input, "model");
  if (!model) return input;
  return normalizeLegacyModelSelection({
    provider: input.provider ?? input.instanceId,
    model,
    options: input.options,
  });
}
