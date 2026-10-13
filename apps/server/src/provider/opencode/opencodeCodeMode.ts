// OpenCode's code mode runs tools from inside its `execute` tool and lists them in the call's
// output metadata.
export function opencodeInnerToolCall(
  rawOutput: unknown,
): { readonly name: string; readonly input: unknown } | undefined {
  const metadata =
    typeof rawOutput === "object" && rawOutput !== null
      ? (rawOutput as { metadata?: { toolCalls?: unknown } }).metadata
      : undefined;
  const calls = Array.isArray(metadata?.toolCalls) ? (metadata.toolCalls as unknown[]) : [];
  const [only] = calls;
  if (calls.length !== 1 || typeof only !== "object" || only === null) return undefined;
  const call = only as { tool?: unknown; input?: unknown };
  return typeof call.tool === "string" && call.tool.trim()
    ? { name: call.tool.trim(), input: call.input ?? {} }
    : undefined;
}
