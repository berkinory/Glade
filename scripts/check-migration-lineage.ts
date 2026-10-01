import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = "apps/server/src/persistence/Migrations";
const baselineId = 1;

function git(args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  return result.stdout;
}

const files = readdirSync(resolve(root, migrationsDir))
  .filter((file) => /^\d+_[^.]+\.ts$/u.test(file))
  .toSorted((a, b) => Number(a.split("_")[0]) - Number(b.split("_")[0]));
const runner = readFileSync(resolve(root, "apps/server/src/persistence/Migrations.ts"), "utf8");
const entriesBlock = runner.match(
  /export const migrationEntries\s*=\s*\[([\s\S]*?)\]\s*as const;/u,
)?.[1];
if (entriesBlock === undefined) throw new Error("Migration runner must declare migrationEntries.");
const imports = new Map(
  Array.from(
    runner.matchAll(/import\s+(\w+)\s+from\s+"\.\/Migrations\/([^"/]+)"/gu),
    (match) => [match[1], match[2]] as const,
  ),
);
const registered = Array.from(
  entriesBlock.matchAll(/\[\s*(\d+)\s*,\s*"([^"]+)"\s*,\s*(\w+)\s*\]/gu),
  (match) => {
    const filename = `${String(Number(match[1])).padStart(3, "0")}_${match[2]}.ts`;
    if (imports.get(match[3]) !== filename)
      throw new Error(`Migration ${filename} imports the wrong implementation.`);
    return filename;
  },
);
if (JSON.stringify(registered) !== JSON.stringify(files)) {
  throw new Error(
    "Migration runner must register every migration file in order with matching IDs and names.",
  );
}
const ids = files.map((file) => Number(file.split("_")[0]));
if (ids[0] !== baselineId || ids.some((id, index) => index > 0 && id !== ids[index - 1]! + 1)) {
  throw new Error(`Migrations must begin at baseline ${baselineId} and append consecutive IDs.`);
}

const tags = git(["tag", "--list", "v[0-9]*"]).trim().split("\n").filter(Boolean);
for (const tag of tags) {
  const released = git(["ls-tree", "-r", "--name-only", tag, "--", migrationsDir])
    .trim()
    .split("\n")
    .filter(Boolean);
  // Preview tags (0.0.x) shipped an unrelated lineage; checks start at the release with this baseline.
  if (!released.includes(`${migrationsDir}/001_Baseline.ts`)) continue;
  for (const file of released) {
    const current = readFileSync(resolve(root, file), "utf8");
    const previous = git(["show", `${tag}:${file}`]);
    if (current !== previous)
      throw new Error(`${file} changed after release ${tag}; append a new migration.`);
  }
}
console.log(`Verified ${files.length} migration files from baseline ${baselineId}.`);
