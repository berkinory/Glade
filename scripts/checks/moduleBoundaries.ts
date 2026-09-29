import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
    if (!resolved || !fileSet.has(path.resolve(resolved.resolvedFileName))) continue;
    const target = path.relative(root, resolved.resolvedFileName).split(path.sep).join("/");
    dependencies.add(target);
    const owner = sourceWorkspace(file);
    const targetOwner = sourceWorkspace(target);
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
