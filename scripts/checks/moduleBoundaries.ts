import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "../..");
const workspaces = [
  "packages/contracts",
  "packages/shared",
  "apps/server",
  "apps/web",
  "apps/desktop",
  "scripts",
];
const configurations = new Map(
  workspaces.map((workspace) => {
    const configPath = path.join(root, workspace, "tsconfig.json");
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error)
      throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
    return [workspace, parsed.options] as const;
  }),
);
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    cwd: root,
    encoding: "utf8",
  },
)
  .split("\0")
  .filter((file) => /\.(?:ts|tsx|mts|cts|mjs|cjs)$/.test(file))
  .filter((file) => existsSync(path.join(root, file)))
  .filter((file) => workspaces.some((workspace) => file.startsWith(`${workspace}/`)));
const fileSet = new Set(files.map((file) => path.join(root, file)));
const graph = new Map<string, string[]>();
const violations: string[] = [];

function sourceWorkspace(file: string): string | undefined {
  return workspaces.find((workspace) => file.startsWith(`${workspace}/src/`));
}

for (const file of files) {
  const absolute = path.join(root, file);
  const workspace = workspaces.find((candidate) => file.startsWith(`${candidate}/`))!;
  const options = configurations.get(workspace)!;
  const source = readFileSync(absolute, "utf8");
  const imports = ts.preProcessFile(source, true, true).importedFiles;
  const dependencies = new Set<string>();
  for (const imported of imports) {
    const resolved = ts.resolveModuleName(
      imported.fileName,
      absolute,
      options,
      ts.sys,
    ).resolvedModule;
    if (!resolved) continue;
    const resolvedFile = realpathSync(resolved.resolvedFileName);
    const target = path.relative(root, resolvedFile).split(path.sep).join("/");
    if (fileSet.has(resolvedFile)) dependencies.add(target);
    const owner = sourceWorkspace(file);
    const targetOwner = workspaces.find((workspace) => target.startsWith(`${workspace}/`));
    if (!owner || !targetOwner || owner === targetOwner) continue;
    if (
      owner === "packages/contracts" ||
      (owner === "packages/shared" && targetOwner !== "packages/contracts") ||
      (owner.startsWith("apps/") && targetOwner.startsWith("apps/"))
    ) {
      violations.push(`${file} imports ${target}`);
    }
  }
  graph.set(file, [...dependencies]);
}

const applicationConsumers = new Map<string, Set<string>>();
const runtimeFiles = files.filter((file) => !/\.(?:test|integration)\./u.test(file));
for (const workspace of workspaces.filter((workspace) => workspace.startsWith("apps/"))) {
  const visited = new Set<string>();
  const pending = runtimeFiles.filter((file) => file.startsWith(`${workspace}/src/`));
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    if (file.startsWith("packages/shared/src/")) {
      const consumers = applicationConsumers.get(file) ?? new Set<string>();
      consumers.add(workspace);
      applicationConsumers.set(file, consumers);
    }
    for (const dependency of graph.get(file) ?? []) pending.push(dependency);
  }
}
for (const file of runtimeFiles.filter((file) => file.startsWith("packages/shared/src/"))) {
  const consumers = applicationConsumers.get(file) ?? new Set<string>();
  if (consumers.size < 2) {
    violations.push(
      `${file} has ${consumers.size} application consumer(s): ${[...consumers].toSorted().join(", ") || "none"}`,
    );
  }
}

const indexes = new Map<string, number>();
const lowLinks = new Map<string, number>();
const active = new Set<string>();
const stack: string[] = [];
const cycles: string[][] = [];
let nextIndex = 0;

function visit(file: string): void {
  const index = nextIndex++;
  indexes.set(file, index);
  lowLinks.set(file, index);
  stack.push(file);
  active.add(file);
  for (const dependency of graph.get(file) ?? []) {
    if (!indexes.has(dependency)) {
      visit(dependency);
      lowLinks.set(file, Math.min(lowLinks.get(file)!, lowLinks.get(dependency)!));
    } else if (active.has(dependency)) {
      lowLinks.set(file, Math.min(lowLinks.get(file)!, indexes.get(dependency)!));
    }
  }
  if (lowLinks.get(file) !== index) return;
  const component: string[] = [];
  let member: string;
  do {
    member = stack.pop()!;
    active.delete(member);
    component.push(member);
  } while (member !== file);
  if (component.length > 1 || graph.get(file)?.includes(file)) cycles.push(component.toSorted());
}

for (const file of graph.keys()) if (!indexes.has(file)) visit(file);
for (const cycle of cycles) {
  violations.push(`Import cycle:\n${cycle.map((file) => `  ${file}`).join("\n")}`);
}
if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Module boundaries verified across ${files.length} files, including type imports.`);
}
