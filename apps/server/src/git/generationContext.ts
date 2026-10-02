import { createHash } from "node:crypto";
import { lstat, open, readlink } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import type { GitCoreShape, GitGenerationContext } from "./Services/GitCore";
import { GitCommandError } from "./Errors";

const INVENTORY_BYTES = 6_000;
const COMMIT_CONTENT_BYTES = 20_000;
const PR_CONTENT_BYTES = 32_000;
const MAX_PATHS = 512;

function prefix(value: string, bytes: number): string {
  const encoded = Buffer.from(value);
  if (encoded.length <= bytes) return value;
  return encoded.subarray(0, Math.max(0, bytes - 40)).toString("utf8") + "\n[content omitted]";
}

function compressCapturedPatch(patch: string): string {
  const lines = patch.split("\n");
  const output: string[] = [];
  let previous = "";
  let repeats = 0;
  const flush = () => {
    if (repeats > 0) output.push(`[${repeats} repeated lines in captured excerpt]`);
    repeats = 0;
  };
  for (const line of lines) {
    if (line === previous && /^[ +-]/.test(line)) {
      repeats++;
      continue;
    }
    flush();
    previous = line;
    output.push(
      line.length > 600 ? line.slice(0, 400) + " [long line excerpt; content omitted]" : line,
    );
  }
  flush();
  return output.join("\n");
}

function category(file: string): string {
  if (
    /(^|\/)([^/]*[.-]lock\.[^/]*|[^/]*\.lock|bun.lockb?|yarn.lock|dist|build|generated|vendor|node_modules)(\/|$)/i.test(
      file,
    )
  )
    return "generated/dependencies";
  if (/migration|package\.json|config|\.(json|toml|ya?ml)$/i.test(file))
    return "configuration/data";
  return file.split("/").slice(0, -1).join("/") || "root";
}

// Stream the complete path inventory, retaining only bounded groups and representatives.
// Content prefix capture stops Git early so a huge hunk cannot erase other change groups.
export function readGenerationContext(
  commands: Pick<GitCoreShape, "execute">,
  cwd: string,
  range?: string,
  includeContent = true,
  forceWorkingTree = false,
): Effect.Effect<GitGenerationContext | null, GitCommandError> {
  return Effect.gen(function* () {
    const read = (args: readonly string[], maxOutputBytes: number) =>
      commands.execute({
        operation: "Git.generationContext",
        cwd,
        args,
        maxOutputBytes,
        outputMode: "prefix",
      });
    const staged = range
      ? null
      : yield* commands.execute({
          operation: "Git.generationContext.index",
          cwd,
          args: ["diff", "--cached", "--quiet"],
          allowNonZeroExit: true,
          maxOutputBytes: 1024,
        });
    if (staged && staged.code > 1)
      return yield* new GitCommandError({
        operation: "Git.generationContext.index",
        cwd,
        command: "git diff --cached --quiet",
        detail: staged.stderr,
      });
    const scope = range
      ? "range"
      : !forceWorkingTree && staged?.code === 1
        ? "staged"
        : "workingTree";
    const diffArgs = range ? [range] : scope === "staged" ? ["--cached"] : ["HEAD"];
    // HEAD does not exist in an unborn repository; its index is the comparison base.
    const head = yield* commands.execute({
      operation: "Git.generationContext.head",
      cwd,
      args: ["rev-parse", "--verify", "HEAD"],
      allowNonZeroExit: true,
      maxOutputBytes: 128,
    });
    if (!range && scope === "workingTree" && head.code !== 0) {
      diffArgs.length = 0;
      if (forceWorkingTree) diffArgs.push("--cached");
    }
    const entries: {
      file: string;
      status: string;
      oldOid?: string | undefined;
      newOid?: string | undefined;
    }[] = [];
    const groups = new Map<string, { count: number; examples: string[] }>();
    const hash = createHash("sha256").update(scope).update(head.stdout);
    const workingStamp = Buffer.alloc(32);
    let fileCount = 0;
    const add = (file: string, status: string) => {
      fileCount++;
      const key = status.split(" ")[0] + " " + category(file);
      const groupKey = groups.has(key) || groups.size < 64 ? key : "other groups";
      const group = groups.get(groupKey) ?? { count: 0, examples: [] };
      group.count++;
      if (group.examples.length < 3) group.examples.push(prefix(file, 180));
      groups.set(groupKey, group);
      if (entries.length < MAX_PATHS) entries.push({ file, status });
    };
    let inspectionError: GitCommandError | undefined;
    const inspect = (file: string) =>
      Effect.tryPromise({
        try: async () => {
          try {
            return await lstat(path.join(cwd, file));
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw error;
          }
        },
        catch: (cause) =>
          new GitCommandError({
            operation: "Git.generationContext.stat",
            cwd,
            command: "stat",
            detail: "Could not inspect changed content. Retry generation.",
            cause,
          }),
      }).pipe(
        Effect.tap((info) =>
          Effect.sync(() => {
            const stamp = createHash("sha256")
              .update(file + (info ? `:${info.size}:${info.mtimeMs}:${info.ctimeMs}` : ":missing"))
              .digest();
            for (let i = 0; i < stamp.length; i++) workingStamp[i] = workingStamp[i]! ^ stamp[i]!;
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => {
            inspectionError = error;
          }),
        ),
      );
    let header = "";
    let renameSource: string | undefined;
    yield* commands.execute({
      operation: "Git.generationContext.inventory",
      cwd,
      args: [
        "diff",
        ...diffArgs,
        "--raw",
        "--no-abbrev",
        scope === "workingTree" ? "--no-renames" : "--find-renames=100%",
        "-z",
      ],
      maxOutputBytes: 131_072,
      outputMode: "truncate",
      progress: {
        stdoutLineDelimiter: "\0",
        onStdoutLine: (field) =>
          Effect.gen(function* () {
            if (scope !== "workingTree") hash.update(field + "\0");
            if (!header) {
              header = field;
              return;
            }
            const parts = header.split(" ");
            const status = parts.at(-1) ?? "M";
            if (/^[RC]/.test(status) && renameSource === undefined) {
              renameSource = field;
              return;
            }
            add(field, renameSource === undefined ? status : `${status} from ${renameSource}`);
            if (entries.length <= MAX_PATHS && entries.at(-1)?.file === field) {
              const entry = entries.at(-1)!;
              entry.oldOid = parts[2];
              entry.newOid = parts[3];
            }
            if (scope === "workingTree") yield* inspect(field);
            header = "";
            renameSource = undefined;
          }),
      },
    });
    if (header)
      return yield* new GitCommandError({
        operation: "Git.generationContext.inventory",
        cwd,
        command: "git diff --raw",
        detail: "Incomplete Git metadata. Retry generation.",
      });
    if (scope === "workingTree")
      yield* commands.execute({
        operation: "Git.generationContext.untracked",
        cwd,
        args: ["ls-files", "--others", "--exclude-standard", "-z"],
        maxOutputBytes: 131_072,
        outputMode: "truncate",
        progress: {
          stdoutLineDelimiter: "\0",
          onStdoutLine: (file) =>
            Effect.gen(function* () {
              if (!file) return;
              add(file, "A (untracked)");
              yield* inspect(file);
            }),
        },
      });
    if (inspectionError) return yield* inspectionError;
    if (scope === "workingTree") hash.update(workingStamp).update(String(fileCount));
    if (fileCount === 0) return null;
    const incomplete = fileCount > entries.length || groups.has("other groups");
    const inventory =
      entries.length === fileCount && fileCount < 40
        ? entries.map((entry) => `${entry.status}\t${entry.file}`).join("\n")
        : Array.from(
            groups,
            ([group, value]) => `${group}: ${value.count}; examples: ${value.examples.join(", ")}`,
          ).join("\n");
    const stagedSummary = prefix(
      `${scope}: ${fileCount}${incomplete ? " (individual path coverage limited; all paths counted)" : ""} changed paths\n${inventory}`,
      INVENTORY_BYTES,
    );
    if (!includeContent)
      return {
        stagedSummary,
        stagedPatch: "",
        snapshot: hash.digest("hex"),
        scope,
        fileCount,
        incomplete,
      };
    const budget = range ? PR_CONTENT_BYTES : COMMIT_CONTENT_BYTES;
    let stagedPatch = "";
    const size = (entry: (typeof entries)[number]) =>
      Effect.gen(function* () {
        let largest = 0;
        for (const oid of [entry.oldOid, entry.newOid]) {
          if (!oid || /^0+$/.test(oid)) continue;
          const result = yield* read(["cat-file", "-s", oid], 128);
          largest = Math.max(largest, Number(result.stdout.trim()));
        }
        if (scope === "workingTree") {
          const info = yield* Effect.tryPromise({
            try: async () => {
              try {
                return await lstat(path.join(cwd, entry.file));
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
                throw error;
              }
            },
            catch: (cause) =>
              new GitCommandError({
                operation: "Git.generationContext.size",
                cwd,
                command: "stat",
                detail: "Could not inspect changed content.",
                cause,
              }),
          });
          largest = Math.max(largest, info?.size ?? 0);
        }
        return largest;
      });
    let small = !incomplete && fileCount < 40;
    if (small) {
      let total = 0;
      for (const entry of entries) {
        total += yield* size(entry);
        if (total > 1_000_000) {
          small = false;
          break;
        }
      }
    }
    const full = small
      ? yield* read(
          ["diff", ...diffArgs, "--patch", "--no-ext-diff", "--no-textconv", "--no-renames"],
          budget,
        )
      : null;
    if (full && !full.stdoutTruncated) stagedPatch = full.stdout;
    else {
      const representatives = new Map<string, (typeof entries)[number]>();
      for (const entry of entries) {
        const key = entry.status + " " + category(entry.file);
        if (!representatives.has(key)) representatives.set(key, entry);
      }
      const priority = (file: string) =>
        category(file) === "configuration/data"
          ? 0
          : category(file) === "generated/dependencies"
            ? 2
            : 1;
      const selected = [...representatives.values()]
        .toSorted((a, b) => priority(a.file) - priority(b.file) || a.file.localeCompare(b.file))
        .slice(0, 24);
      const allocation = Math.floor((budget - 1200) / Math.max(1, selected.length));
      for (const entry of selected) {
        const bytes = yield* size(entry);
        if (bytes > 1_000_000) {
          stagedPatch += prefix(
            `${entry.status} ${entry.file}: content omitted (${bytes} bytes)\n`,
            allocation,
          );
          continue;
        }
        const result = yield* read(
          [
            "diff",
            ...diffArgs,
            "--patch",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            "--",
            `:(literal)${entry.file}`,
          ],
          allocation,
        );
        stagedPatch +=
          prefix(compressCapturedPatch(result.stdout), allocation) +
          (result.stdoutTruncated ? "\n[remaining hunks omitted]" : "") +
          "\n";
      }
      stagedPatch += "\n[selective content; other files are represented by inventory only]";
    }
    for (const entry of entries.filter((entry) => entry.status === "A (untracked)").slice(0, 8)) {
      const remaining = budget - Buffer.byteLength(stagedPatch) - 256;
      if (remaining <= 0) break;
      const content = yield* Effect.tryPromise({
        try: async () => {
          const filename = path.join(cwd, entry.file);
          const info = await lstat(filename);
          if (info.isSymbolicLink()) return `Symlink target: ${await readlink(filename)}`;
          const handle = await open(filename, "r");
          try {
            const buffer = Buffer.alloc(Math.min(remaining, 4096));
            const { bytesRead } = await handle.read(buffer);
            return buffer.subarray(0, bytesRead).includes(0)
              ? "[binary content]"
              : buffer.subarray(0, bytesRead).toString("utf8");
          } finally {
            await handle.close();
          }
        },
        catch: (cause) =>
          new GitCommandError({
            operation: "Git.generationContext.content",
            cwd,
            command: "read",
            detail: "Could not read selected untracked content.",
            cause,
          }),
      });
      stagedPatch += `\nUntracked ${entry.file} (bounded excerpt):\n${content}`;
    }
    const captured = stagedPatch.split("\n");
    const added = captured.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
    const removed = captured.filter(
      (line) => line.startsWith("-") && !line.startsWith("---"),
    ).length;
    stagedPatch += `\n[captured content: ${added} added, ${removed} removed lines; omitted content is not counted]`;
    stagedPatch = prefix(stagedPatch, budget);
    return {
      stagedSummary,
      stagedPatch,
      snapshot: hash.digest("hex"),
      scope,
      fileCount,
      incomplete,
    };
  });
}
