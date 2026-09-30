export class CodexSessionStartError extends Error {
  override readonly name = "CodexSessionStartError";
}

const NON_FATAL_CODEX_ERROR_SNIPPETS = [
  "write_stdin failed: stdin is closed for this session",
] as const;

export function isNonFatalCodexErrorMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return NON_FATAL_CODEX_ERROR_SNIPPETS.some((snippet) => normalized.includes(snippet));
}
