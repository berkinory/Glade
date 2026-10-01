import { parsePatchFiles } from "@pierre/diffs";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GitCoreLive } from "../src/git/Layers/GitCore";
import { GitCore } from "../src/git/Services/GitCore";
import { ServerConfig } from "../src/server/config";

const cwd = resolve(process.argv[2] ?? process.cwd());
const samples = Number(process.argv[3] ?? 20);
if (!Number.isInteger(samples) || samples < 5 || samples > 100) {
  throw new Error("Sample count must be an integer between 5 and 100.");
}
const fixture = mkdtempSync(join(tmpdir(), "glade-latency ü space-"));
const tracePath = join(fixture, "trace.jsonl");
const mutationCwd = join(fixture, "repository ü space");
mkdirSync(mutationCwd);
const config = ServerConfig.layerTest(fixture, { prefix: "glade-latency-profile-" });
const layer = GitCoreLive.pipe(Layer.provide(config), Layer.provide(NodeServices.layer));
const previousTrace = process.env.GIT_TRACE2_EVENT;

try {
  await Effect.runPromise(
    Effect.gen(function* () {
      const git = yield* GitCore;
      const command = (root: string, args: readonly string[]) =>
        git.execute({ operation: "measureGitLatency", cwd: root, args });
      const measure = <A, E, R>(
        action: string,
        root: string,
        run: () => Effect.Effect<A, E, R>,
        prepare: () => Effect.Effect<unknown, E, R> = () => Effect.void,
      ) =>
        Effect.gen(function* () {
          const timings: number[] = [];
          const executions: number[] = [];
          let responseBytes = 0;
          let gitMs = 0;
          for (let index = 0; index < samples; index++) {
            delete process.env.GIT_TRACE2_EVENT;
            yield* prepare();
            writeFileSync(tracePath, "");
            process.env.GIT_TRACE2_EVENT = tracePath;
            const start = performance.now();
            const result = yield* run();
            timings.push(performance.now() - start);
            responseBytes += Buffer.byteLength(JSON.stringify(result) ?? "");
            const trace = readFileSync(tracePath, "utf8")
              .trim()
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line) as { event: string; t_abs?: number });
            executions.push(trace.filter((entry) => entry.event === "start").length);
            gitMs += trace
              .filter((entry) => entry.event === "exit")
              .reduce((sum, entry) => sum + (entry.t_abs ?? 0) * 1000, 0);
          }
          delete process.env.GIT_TRACE2_EVENT;
          const sorted = timings.toSorted((a, b) => a - b);
          console.log(
            JSON.stringify({
              action,
              cwd: root,
              samples,
              firstMs: Number(timings[0]!.toFixed(2)),
              medianMs: Number(sorted[Math.floor(samples / 2)]!.toFixed(2)),
              p95Ms: Number(sorted[Math.ceil(samples * 0.95) - 1]!.toFixed(2)),
              commands: executions.reduce((sum, n) => sum + n, 0) / samples,
              meanGitMs: Number((gitMs / samples).toFixed(2)),
              meanResponseBytes: Math.round(responseBytes / samples),
            }),
          );
        });
      const history = yield* git.listRecentCommits({ cwd, limit: 20 });
      console.log(
        JSON.stringify({
          platform: process.platform,
          repository: cwd,
          git: (yield* command(cwd, ["--version"])).stdout.trim(),
          trackedFiles: (yield* command(cwd, ["ls-files", "-z"])).stdout.split("\0").length - 1,
          commits: (yield* command(cwd, ["rev-list", "--count", "HEAD"])).stdout.trim(),
          changedFiles: (yield* command(cwd, ["status", "--porcelain"])).stdout
            .trim()
            .split("\n")
            .filter(Boolean).length,
          objectStorage: (yield* command(cwd, ["count-objects", "-v"])).stdout.trim(),
          cache: "warm OS cache; fresh application reads; no network",
        }),
      );
      yield* measure("history-open", cwd, () => git.listRecentCommits({ cwd, limit: 20 }));
      yield* measure("history-next-page", cwd, () =>
        git.listRecentCommits({ cwd, limit: 20, offset: 20 }),
      );
      if (history.commits[0]) {
        const sha = history.commits[0].sha;
        yield* measure("commit-open", cwd, () => git.readCommit({ cwd, sha }));
        const detail = yield* git.readCommit({ cwd, sha });
        yield* measure("diff-parse", cwd, () => Effect.sync(() => parsePatchFiles(detail.patch)));
        yield* measure("history-with-concurrent-status", cwd, () =>
          Effect.all([git.listRecentCommits({ cwd, limit: 20 }), git.statusDetails(cwd)], {
            concurrency: "unbounded",
          }),
        );
      }
      yield* git.initRepo({ cwd: mutationCwd });
      yield* command(mutationCwd, ["config", "user.name", "Latency"]);
      yield* command(mutationCwd, ["config", "user.email", "latency@example.invalid"]);
      writeFileSync(join(mutationCwd, "file ü.txt"), "original\n");
      yield* command(mutationCwd, ["add", "."]);
      yield* git.commit(mutationCwd, "initial", "");
      const file = "file ü.txt";
      yield* measure(
        "stage-file",
        mutationCwd,
        () => git.stageFiles(mutationCwd, [file]),
        () =>
          Effect.gen(function* () {
            yield* git.unstageFiles(mutationCwd, [file]);
            appendFileSync(join(mutationCwd, file), "edit\n");
          }),
      );
      yield* measure(
        "unstage-file",
        mutationCwd,
        () => git.unstageFiles(mutationCwd, [file]),
        () => git.stageFiles(mutationCwd, [file]),
      );
      yield* measure(
        "selective-stash",
        mutationCwd,
        () => command(mutationCwd, ["stash", "push", "--", file]),
        () => Effect.sync(() => appendFileSync(join(mutationCwd, file), "edit\n")),
      );
      let restoredContent = "";
      let restoreIndex = 0;
      yield* measure(
        "stash-restore",
        mutationCwd,
        () =>
          Effect.gen(function* () {
            const result = yield* command(mutationCwd, ["stash", "pop"]);
            if (readFileSync(join(mutationCwd, file), "utf8") !== restoredContent) {
              throw new Error("Stash restore changed file contents");
            }
            return result;
          }),
        () =>
          Effect.gen(function* () {
            yield* command(mutationCwd, ["restore", "--worktree", "--", file]);
            restoredContent = `original\nrestore ${restoreIndex++}\n`;
            writeFileSync(join(mutationCwd, file), restoredContent);
            yield* command(mutationCwd, ["stash", "push", "--", file]);
          }),
      );
      yield* measure(
        "working-tree-discard",
        mutationCwd,
        () => git.revertUnstagedFile(mutationCwd, file),
        () => Effect.sync(() => appendFileSync(join(mutationCwd, file), "discard\n")),
      );
      if (readFileSync(join(mutationCwd, file), "utf8") !== "original\n")
        throw new Error("Discard changed baseline contents");
      yield* measure(
        "commit",
        mutationCwd,
        () => git.commit(mutationCwd, "measured", ""),
        () =>
          Effect.gen(function* () {
            appendFileSync(join(mutationCwd, file), "commit\n");
            yield* git.stageFiles(mutationCwd, [file]);
          }),
      );
      yield* measure("committed-history-revert", mutationCwd, () =>
        command(mutationCwd, ["revert", "--no-edit", "HEAD"]),
      );
      const committed = (yield* command(mutationCwd, ["show", `HEAD:${file}`])).stdout;
      const indexed = (yield* command(mutationCwd, ["show", `:${file}`])).stdout;
      if (committed !== indexed || indexed !== readFileSync(join(mutationCwd, file), "utf8")) {
        throw new Error("Committed, indexed and working-tree contents differ");
      }
      console.log(
        JSON.stringify({ verification: "stash, discard, commit and revert contents preserved" }),
      );
    }).pipe(Effect.provide(layer), Effect.scoped),
  );
} finally {
  if (previousTrace === undefined) delete process.env.GIT_TRACE2_EVENT;
  else process.env.GIT_TRACE2_EVENT = previousTrace;
  rmSync(fixture, { recursive: true, force: true });
}
