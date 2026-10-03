import fs from "node:fs/promises";
import path from "node:path";
import type {
  ProjectSearchContentInput,
  ProjectSearchContentResult,
} from "@glade/contracts/workspace/project";
import {
  PROJECT_SEARCH_CONTENT_MAX_LIMIT,
  PROJECT_SEARCH_CONTENT_MAX_LINE_LENGTH,
  PROJECT_SEARCH_CONTENT_MIN_QUERY_LENGTH,
} from "@glade/contracts/workspace/project";
import { createContentSearchPattern } from "@glade/shared/text/searchQuery";
import { resolveRealPathWithinRoot } from "./realPathContainment";

interface ContentIndex {
  entries: readonly { path: string; kind: "file" | "directory" }[];
  truncated: boolean;
}
interface CachedContent {
  fingerprint: string;
  contents: string | null;
  bytes: number;
}

function abortable<A>(promise: Promise<A>, signal: AbortSignal): Promise<A> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export class WorkspaceContentSearch {
  private readonly files = new Map<string, CachedContent>();
  private bytes = 0;

  private remember(key: string, value: CachedContent) {
    this.bytes -= this.files.get(key)?.bytes ?? 0;
    this.files.delete(key);
    this.files.set(key, value);
    this.bytes += value.bytes;
    while (this.bytes > 32 * 1024 * 1024 || this.files.size > 2_500) {
      const oldest = this.files.keys().next().value;
      if (oldest === undefined) break;
      this.bytes -= this.files.get(oldest)!.bytes;
      this.files.delete(oldest);
    }
  }

  private async read(
    cwd: string,
    relativePath: string,
    signal: AbortSignal,
  ): Promise<string | null> {
    signal.throwIfAborted();
    const absolute = await resolveRealPathWithinRoot(cwd, path.join(cwd, relativePath));
    if (!absolute) return null;
    const handle = await fs.open(absolute, "r");
    try {
      const stat = await handle.stat({ bigint: true });
      signal.throwIfAborted();
      const fingerprint = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
      const cached = this.files.get(absolute);
      if (cached?.fingerprint === fingerprint) {
        this.files.delete(absolute);
        this.files.set(absolute, cached);
        return cached.contents;
      }
      let contents: string | null = null;
      if (stat.isFile() && stat.size > 0n && stat.size <= 512n * 1024n) {
        const buffer = Buffer.alloc(Number(stat.size));
        let bytesRead = 0;
        while (bytesRead < buffer.length) {
          signal.throwIfAborted();
          const read = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
          if (read.bytesRead === 0) break;
          bytesRead += read.bytesRead;
        }
        if (!buffer.subarray(0, Math.min(bytesRead, 8 * 1024)).includes(0))
          contents = buffer.subarray(0, bytesRead).toString("utf8");
      }
      signal.throwIfAborted();
      this.remember(absolute, {
        fingerprint,
        contents,
        bytes: (contents?.length ?? 0) * 2 + absolute.length * 2 + 128,
      });
      return contents;
    } finally {
      await handle.close();
    }
  }

  async search(
    input: ProjectSearchContentInput,
    getIndex: () => Promise<ContentIndex>,
    externalSignal?: AbortSignal,
  ): Promise<ProjectSearchContentResult> {
    const query = input.query.trim();
    if (query.length < PROJECT_SEARCH_CONTENT_MIN_QUERY_LENGTH)
      return { matches: [], truncated: false };
    const timeout = AbortSignal.timeout(4_000);
    const signal = externalSignal ? AbortSignal.any([externalSignal, timeout]) : timeout;
    const matches: ProjectSearchContentResult["matches"][number][] = [];
    let truncated = false;
    const limit = Math.max(1, Math.min(input.limit ?? 50, PROJECT_SEARCH_CONTENT_MAX_LIMIT));
    try {
      // Other searches share this index build; cancellation ends this wait without cancelling their build.
      const index = await abortable(getIndex(), signal);
      truncated = index.truncated;
      const files = index.entries.filter((entry) => entry.kind === "file");
      let next = 0;
      let scanned = 0;
      await Promise.all(
        Array.from({ length: Math.min(8, files.length) }, async () => {
          const pattern = createContentSearchPattern(query, input);
          while (next < files.length && matches.length <= limit && !signal.aborted) {
            const file = files[next++]!;
            let contents: string | null;
            try {
              contents = await this.read(input.cwd, file.path, signal);
            } catch (error) {
              if (signal.aborted) break;
              if (
                (error as NodeJS.ErrnoException).code !== "ENOENT" &&
                (error as NodeJS.ErrnoException).code !== "EACCES" &&
                (error as NodeJS.ErrnoException).code !== "EPERM"
              )
                throw error;
              contents = null;
            }
            scanned++;
            if (contents === null) continue;
            pattern.lastIndex = 0;
            if (!pattern.test(contents)) continue;
            const lines = contents.split("\n");
            for (let i = 0; i < lines.length && matches.length <= limit; i++) {
              signal.throwIfAborted();
              const line = lines[i]!;
              pattern.lastIndex = 0;
              if (!pattern.test(line)) continue;
              const text = line.trimEnd();
              matches.push({
                path: file.path,
                lineNumber: i + 1,
                lineText:
                  text.length > PROJECT_SEARCH_CONTENT_MAX_LINE_LENGTH
                    ? `${text.slice(0, PROJECT_SEARCH_CONTENT_MAX_LINE_LENGTH - 1)}…`
                    : text,
              });
            }
          }
        }),
      );
      truncated ||= scanned < files.length || matches.length > limit;
    } catch (error) {
      if (!timeout.aborted || externalSignal?.aborted) throw error;
      truncated = true;
    }
    externalSignal?.throwIfAborted();
    truncated ||= matches.length > limit;
    matches.sort((a, b) => a.path.localeCompare(b.path) || a.lineNumber - b.lineNumber);
    matches.splice(limit);
    return { matches, truncated: truncated || timeout.aborted };
  }
}
