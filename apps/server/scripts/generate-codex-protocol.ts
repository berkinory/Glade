import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const release = "0.158.0";
const roots = [
  "v2/ModelListParams",
  "v2/ModelListResponse",
  "v2/GetAccountResponse",
  "v2/GetAccountRateLimitsResponse",
  "v2/ListMcpServerStatusResponse",
  "v2/ConfigReadResponse",
  "v2/ConfigWriteResponse",
  "v2/McpServerOauthLoginResponse",
  "v2/PluginInstalledResponse",
  "v2/PluginInstallResponse",
  "v2/PluginUninstallResponse",
  "v2/McpServerRefreshResponse",
  "v2/ErrorNotification",
  "v2/SkillsListParams",
  "v2/SkillsListResponse",
  "v2/PluginListParams",
  "v2/PluginListResponse",
  "v2/PluginReadParams",
  "v2/PluginReadResponse",
];
const envelopes = ["ServerNotification", "ServerRequest", "JSONRPCErrorError"];
const lifecycleResponses = [
  "ReviewStartResponse",
  "SkillsExtraRootsSetResponse",
  "ThreadCompactStartResponse",
  "ThreadForkResponse",
  "ThreadReadResponse",
  "ThreadResumeResponse",
  "ThreadRevertResponse",
  "ThreadStartResponse",
  "ThreadTurnsListResponse",
  "TurnInterruptResponse",
  "TurnStartResponse",
  "TurnSteerResponse",
];
const target = resolve(import.meta.dir, "../src/provider/codex/protocol/generated");
const executable = process.env.GLADE_CODEX_PROTOCOL_CLI ?? "codex";
const check = process.argv.includes("--check");

function run(args: string[]): string {
  const result = spawnSync(executable, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`Codex protocol generation failed: ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout.trim();
}

function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  });
}

if (run(["--version"]) !== `codex-cli ${release}`) {
  throw new Error(`Protocol source must be codex-cli ${release}.`);
}

const temporary = mkdtempSync(join(tmpdir(), "glade-codex-protocol-"));
try {
  const jsonDirectory = join(temporary, "json");
  const tsDirectory = join(temporary, "ts");
  run(["app-server", "generate-json-schema", "--experimental", "--out", jsonDirectory]);
  run(["app-server", "generate-ts", "--experimental", "--out", tsDirectory]);

  const allSchemaFiles = filesIn(jsonDirectory).toSorted();
  const schemaDigest = createHash("sha256");
  for (const file of allSchemaFiles) {
    schemaDigest.update(relative(jsonDirectory, file));
    schemaDigest.update("\0");
    schemaDigest.update(readFileSync(file));
    schemaDigest.update("\0");
  }

  const output = new Map<string, string>();
  const types = new Set<string>();
  function addType(name: string): void {
    if (types.has(name)) return;
    types.add(name);
    const source = readFileSync(join(tsDirectory, `${name}.ts`), "utf8");
    output.set(`types/${name}.ts`, source);
    for (const [, dependency] of source.matchAll(/from "(\.{1,2}\/[^"]+)"/g)) {
      if (!dependency) continue;
      const path = relative(tsDirectory, resolve(tsDirectory, dirname(name), dependency));
      addType(path);
    }
  }
  for (const name of roots) addType(name);
  for (const name of [...roots, ...envelopes, ...lifecycleResponses.map((name) => `v2/${name}`)]) {
    output.set(`schemas/${name}.json`, readFileSync(join(jsonDirectory, `${name}.json`), "utf8"));
  }
  output.set(
    "metadata.json",
    `${JSON.stringify(
      {
        release: `rust-v${release}`,
        source: "codex app-server generate-json-schema and generate-ts",
        schemaDigest: `sha256:${schemaDigest.digest("hex")}`,
        generatorVersion: `codex-cli ${release}`,
        experimental: true,
        schemaFiles: allSchemaFiles.length,
      },
      null,
      2,
    )}\n`,
  );

  for (const [path, content] of output) {
    const destination = join(target, path);
    if (check) {
      if (!existsSync(destination) || readFileSync(destination, "utf8") !== content) {
        throw new Error(`Generated Codex protocol differs: ${path}`);
      }
      continue;
    }
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  if (check) console.log("Codex protocol artifacts match the pinned release.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
