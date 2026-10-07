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
    noExternal: (id) => id.startsWith("@glade/"),
  },
  {
    ...shared,
    entry: ["src/preload.ts"],
  },
]);
