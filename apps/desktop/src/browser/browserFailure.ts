import type { BrowserFailureCode } from "@glade/contracts/browser/browserHost";

// Thrown by every browser host module; the RPC server forwards `code` to the server as
// `error.data.code` so the gateway can return a typed tool error.
export class BrowserFailure extends Error {
  constructor(
    readonly code: BrowserFailureCode,
    message: string,
  ) {
    super(message);
  }
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new BrowserFailure("timeout", `${what} timed out after ${timeoutMs} ms.`)),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
