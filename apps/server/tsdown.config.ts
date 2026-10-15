import { defineConfig } from "tsdown";
import { asciiOnlyChunks } from "../../scripts/lib/asciiOnlyChunks.ts";

const sourcemapEnv = process.env.GLADE_SERVER_SOURCEMAP?.trim().toLowerCase();
const buildSourcemap = sourcemapEnv === "1" || sourcemapEnv === "true";
export default defineConfig({
  entry: {
    index: "src/index.ts",
    runtimeDependencySmoke: "src/platform/runtimeDependencySmoke.ts",
    remoteLauncher: "src/remote/remoteLauncher.ts",
    glade: "src/remote/cli/gladeCli.ts",
  },
  format: ["esm"],
  outDir: "dist",

  external: [/^bun:/u],
  sourcemap: buildSourcemap,
  plugins: [asciiOnlyChunks({ enabled: !buildSourcemap })],
  clean: true,
  // Effect is bundled so the server loads only the modules it uses, without their JSDoc-heavy
  // sources (13MB of module text resident in the heap), as the desktop host does. Every package
  // that imports effect is under @effect/, so no second copy loads from node_modules.
  noExternal: (id) =>
    id.startsWith("@glade/") ||
    id === "@pierre/diffs" ||
    id === "effect" ||
    id.startsWith("effect/") ||
    id.startsWith("@effect/"),
  inlineOnly: false,
  banner: {
    js: "#!/usr/bin/env node\n",
  },
});
