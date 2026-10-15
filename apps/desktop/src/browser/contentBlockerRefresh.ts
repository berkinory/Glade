import { ElectronBlocker } from "@ghostery/adblocker-electron";
import { net } from "electron";
import * as FS from "node:fs";
import * as Path from "node:path";

// Utility-process entry: builds the engine from the prebuilt lists and writes it to the cache file
// given as the first argument. Parsing the lists leaves ~180MB the allocator never returns, so the
// main process only ever deserializes the result.
async function rebuild(cachePath: string): Promise<void> {
  const engine = await ElectronBlocker.fromPrebuiltFull((url: string) => net.fetch(url));
  const temporary = `${cachePath}.${process.pid}.tmp`;
  FS.mkdirSync(Path.dirname(cachePath), { recursive: true });
  FS.writeFileSync(temporary, engine.serialize());
  FS.renameSync(temporary, cachePath);
}

const cachePath = process.argv[2];
if (!cachePath) {
  process.parentPort.postMessage({ error: "missing cache path" });
  process.exit(1);
}
rebuild(cachePath).then(
  () => process.exit(0),
  (error: unknown) => {
    process.parentPort.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  },
);
