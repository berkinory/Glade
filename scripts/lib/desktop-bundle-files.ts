const DIAGNOSTIC_FILES = [
  "!node_modules/**/*.{js,mjs,cjs,ts,mts,cts}.map",
  "!node_modules/**/*.{d.mts,d.cts,tsbuildinfo}",

  "!node_modules/effect/src/**/*.ts",
  "!node_modules/@effect/{platform-node,platform-node-shared,sql-sqlite-bun}/src/**/*.ts",
  "!node_modules/openai/src/**/*.ts",
  "!node_modules/@anthropic-ai/sdk/src/**/*.ts",
] as const;

export function preserveDependencyDiagnostics(env: NodeJS.ProcessEnv): boolean {
  return [env.GLADE_WEB_SOURCEMAP, env.GLADE_SERVER_SOURCEMAP, env.GLADE_DESKTOP_SOURCEMAP].some(
    (value) => ["1", "true", "hidden"].includes(value?.trim().toLowerCase() ?? ""),
  );
}

export function createDesktopBundleFilePatterns(
  platform: "mac" | "linux" | "win",
  options: { readonly diagnostics?: boolean } = {},
): string[] {
  const files = ["**/*"];
  if (!options.diagnostics) files.push(...DIAGNOSTIC_FILES);

  files.push(
    "!node_modules/patchright-core/**",
    "!node_modules/@anthropic-ai/claude-agent-sdk-darwin-*/**",
    "!node_modules/@anthropic-ai/claude-agent-sdk-linux-*/**",
    "!node_modules/@anthropic-ai/claude-agent-sdk-win32-*/**",
  );

  // Desktop serves original files; HTTP clients keep Brotli and identity responses.
  files.push("!apps/server/dist/client/**/*.gz");

  // These browser UI payloads are loaded only by the unused HttpApiSwagger/Scalar services.
  files.push("!node_modules/effect/dist/unstable/httpapi/internal/httpApi{Swagger,Scalar}.js");

  if (platform !== "mac") files.push("!node_modules/node-pty/prebuilds/darwin-*/**");
  if (platform !== "win") files.push("!node_modules/node-pty/prebuilds/win32-*/**");
  files.push("!node_modules/node-pty/lib/*.test.js");

  files.push(
    "!node_modules/node-pty/build/**/*.{iobj,ipdb,tlog,vcxproj,filters,recipe,lastbuildstate,exp,lib}",
  );

  // All icon preferences for the target OS and the menu fallback remain intact. Build resources
  // (signing entitlements / installer icons) are left untouched; only their otherwise redundant
  // runtime copies are filtered here.
  const resources = "!apps/desktop/prod-resources/";
  files.push(`${resources}entitlements.mac*.plist`);
  if (platform !== "mac") {
    files.push(
      `${resources}app-icon-macos.png`,
      `${resources}dock-icon*.png`,
      `${resources}icon.icns`,
    );
  }
  if (platform !== "linux")
    files.push(`${resources}app-icon-linux.png`, `${resources}icon-dark.png`);
  if (platform !== "win")
    files.push(
      `${resources}app-icon-windows.ico`,
      `${resources}icon.ico`,
      `${resources}icon-dark.ico`,
    );

  return files;
}
