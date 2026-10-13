// Droid names models without their vendor; the slug's leading word identifies it.
const VENDORS: Readonly<Record<string, string>> = {
  claude: "Anthropic",
  gpt: "OpenAI",
  gemini: "Google",
  grok: "xAI",
  kimi: "Moonshot AI",
  glm: "Z.ai",
  deepseek: "DeepSeek",
  mistral: "Mistral AI",
  qwen: "Qwen",
  nemotron: "NVIDIA",
  minimax: "MiniMax",
};

export function droidModelVendor(slug: string): string | undefined {
  return VENDORS[/^[a-z]+/u.exec(slug)?.[0] ?? ""];
}
