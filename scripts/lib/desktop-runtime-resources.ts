import { Effect, FileSystem, Path } from "effect";

// Copying them into the runtime tree would ship megabytes the app never resolves there: bundle
// artwork, and the Cua Driver, which electron-builder places in Resources outside ASAR.
const BUNDLE_ONLY_RESOURCE_ENTRIES = new Set(["dmgly", "Assets.car", "Glade.icns", "cua-driver"]);

export const stageDesktopRuntimeResources = Effect.fn("stageDesktopRuntimeResources")(function* (
  buildResourcesDir: string,
  runtimeResourcesDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const entries = yield* fs.readDirectory(buildResourcesDir);
  yield* fs.makeDirectory(runtimeResourcesDir, { recursive: true });
  for (const entry of entries) {
    if (BUNDLE_ONLY_RESOURCE_ENTRIES.has(entry)) continue;
    yield* fs.copy(path.join(buildResourcesDir, entry), path.join(runtimeResourcesDir, entry));
  }
});
