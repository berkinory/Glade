import { formatEffortLabel } from "@glade/shared/provider/effortLabel";

// Cursor names each model by its raw id, such as "claude-opus-5-5[context=300k,effort=medium]".
// Each id is one fixed variant, so its settings belong in the name, as in Cursor's own picker:
// "Claude Opus 5.5 300K Medium".
const VENDORS: Readonly<Record<string, string>> = {
  claude: "Anthropic",
  gpt: "OpenAI",
  gemini: "Google",
  grok: "xAI",
  composer: "Cursor",
  kimi: "Moonshot AI",
  glm: "Z.ai",
  muse: "Meta",
};
const ACRONYMS = new Set(["gpt", "glm"]);
const EFFORT_KEYS = ["effort", "reasoning_effort", "reasoning"];

function variantParams(slug: string): ReadonlyMap<string, string> {
  const params = /\[([^\]]*)\]$/u.exec(slug)?.[1] ?? "";
  return new Map(
    params.split(",").flatMap((pair) => {
      const [key, value] = pair.split("=").map((part) => part.trim());
      return key && value ? [[key, value] as const] : [];
    }),
  );
}

function baseName(base: string): string {
  const words: string[] = [];
  for (const token of base.split("-")) {
    const previous = words.at(-1);
    // "opus-5-5" is version 5.5 and "5p3" is 5.3.
    if (/^\d+$/u.test(token) && previous && /\d$/u.test(previous)) {
      words[words.length - 1] = `${previous}.${token}`;
      continue;
    }
    const version = token.replace(/^(\d+)p(\d+)$/u, "$1.$2");
    words.push(
      ACRONYMS.has(version)
        ? version.toUpperCase()
        : /^\d/u.test(version)
          ? version
          : version.charAt(0).toUpperCase() + version.slice(1),
    );
  }
  // OpenAI writes its versions onto the acronym: "GPT-5.6".
  return words.join(" ").replace(/^GPT (\d)/u, "GPT-$1");
}

export function presentCursorModel(
  slug: string,
  name: string,
): { readonly name: string; readonly vendor?: string } {
  const base = slug.replace(/\[[^\]]*\]$/u, "");
  if (base === "default") return { name };
  const params = variantParams(slug);
  const effortKey = EFFORT_KEYS.find((key) => params.has(key));
  const parts = [
    baseName(base),
    params.get("context")?.toUpperCase(),
    effortKey ? formatEffortLabel(params.get(effortKey)!) : undefined,
    params.get("thinking") === "true" ? "Thinking" : undefined,
    params.get("fast") === "true" ? "Fast" : undefined,
  ];
  const vendor = VENDORS[base.split("-")[0] ?? ""];
  return {
    name: parts.filter((part): part is string => part !== undefined).join(" "),
    ...(vendor ? { vendor } : {}),
  };
}
