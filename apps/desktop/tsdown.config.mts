import { defineConfig } from "tsdown";

const sourcemapEnv = process.env.GLADE_DESKTOP_SOURCEMAP?.trim().toLowerCase();
const buildSourcemap = sourcemapEnv === "1" || sourcemapEnv === "true";
const windowsUpdaterPublisher = process.env.AZURE_TRUSTED_SIGNING_SUBJECT_DN?.trim() ?? "";
const shared = {
  format: "cjs" as const,
  outDir: "dist-electron",
  sourcemap: buildSourcemap,
  outExtensions: () => ({ js: ".js" }),
};

export default defineConfig([
  {
    ...shared,
    entry: ["src/main.ts"],
    clean: true,

    external: ["original-fs"],
    define: {
      __GLADE_WINDOWS_UPDATER_PUBLISHER__: JSON.stringify(windowsUpdaterPublisher),
    },
    // Effect is bundled so the host loads only the modules it uses instead of its whole barrel.
    noExternal: (id) => id.startsWith("@glade/") || id === "effect" || id.startsWith("effect/"),
    inlineOnly: ["effect"],
    // Effect reads `import.meta.env` only as an optional source next to `process.env`.
    checks: { emptyImportMeta: false },
  },
  {
    ...shared,
    entry: ["src/preload.ts"],
  },
  {
    ...shared,
    entry: ["src/browser/contentBlockerRefresh.ts"],
  },
]);
