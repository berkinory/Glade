import { defineConfig } from "tsdown";

const sourcemapEnv = process.env.GLADE_SERVER_SOURCEMAP?.trim().toLowerCase();
const buildSourcemap = sourcemapEnv === "1" || sourcemapEnv === "true";
export default defineConfig({
  entry: {
    index: "src/index.ts",
    runtimeDependencySmoke: "src/platform/runtimeDependencySmoke.ts",
    remoteLauncher: "src/remote/remoteLauncher.ts",
  },
  format: ["esm"],
  outDir: "dist",

  external: [/^bun:/u],
  sourcemap: buildSourcemap,
  clean: true,
  noExternal: (id) => id.startsWith("@glade/") || id === "@pierre/diffs",
  inlineOnly: false,
  banner: {
    js: "#!/usr/bin/env node\n",
  },
});
