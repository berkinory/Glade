// Electron prefixes errors thrown across IPC with the channel; the user only needs the message.
export function ipcErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return error.message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/u, "");
}
