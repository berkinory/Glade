import type { EmbeddedCuaDriverHostLike } from "@trycua/cua-driver";
import type { CuaDaemon } from "./cuaWindowsDaemon";

// The SDK's own waitForExit polls its Rust future about 18 times a second, and the napi runtime
// never releases the callback it creates for each poll. Every leaked callback keeps a libuv async
// handle that each later event-loop wakeup scans, so an hour of watching one daemon made every
// wakeup of the main process cost milliseconds. Checking the synchronous connection leaves nothing
// behind; the SDK's waitForExit runs only once the generation is gone, when it resolves at once.
const EXIT_CHECK_MS = 1_000;

export function createEmbeddedCuaDaemon(host: EmbeddedCuaDriverHostLike): CuaDaemon {
  return {
    start: () => host.start(),
    restart: () => host.restart(),
    stop: () => host.stop(),
    waitForExit: (generation) =>
      new Promise((resolve, reject) => {
        const check = setInterval(() => {
          try {
            if (host.connection()?.generation === generation) return;
          } catch (error) {
            clearInterval(check);
            reject(error);
            return;
          }
          clearInterval(check);
          host.waitForExit(generation).then(resolve, reject);
        }, EXIT_CHECK_MS);
      }),
  };
}
