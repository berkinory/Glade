import type { DownloadItem } from "electron";
import * as FS from "node:fs";
import * as Path from "node:path";

const MAX_KEPT = 10;

interface Download {
  readonly name: string;
  readonly path: string;
  readonly startedAt: number;
  state: "progressing" | "completed" | "cancelled" | "interrupted";
  received: number;
  total: number;
}

function bytes(count: number): string {
  if (count < 1024) return `${count} B`;
  if (count < 1024 * 1024) return `${(count / 1024).toFixed(1)} KB`;
  return `${(count / 1024 / 1024).toFixed(1)} MB`;
}

// Every folder below the workspace is created or checked without following links, so a symlinked
// `.glade` or `downloads` cannot send a page's download outside the workspace.
export function downloadTarget(workspaceDir: string, suggested: string): string {
  let directory = FS.realpathSync(workspaceDir);
  for (const part of [".glade", "downloads"]) {
    directory = Path.join(directory, part);
    FS.mkdirSync(directory, { recursive: true });
    if (!FS.lstatSync(directory).isDirectory()) {
      throw new Error(`${directory} is not a plain folder.`);
    }
  }
  writeExclusive(Path.join(directory, ".gitignore"), "*\n");
  const base = Path.basename(suggested).replace(/[\u0000-\u001f<>:"/\\|?*]/gu, "_") || "download";
  const { name, ext } = Path.parse(base);
  // Reserving the name with an exclusive create keeps two downloads from claiming the same file.
  for (let index = 0; ; index += 1) {
    const candidate = Path.join(directory, index === 0 ? base : `${name} (${index})${ext}`);
    if (writeExclusive(candidate, "")) return candidate;
  }
}

// Fails on any existing entry, including a dangling symlink, instead of writing through it.
function writeExclusive(path: string, contents: string): boolean {
  try {
    FS.writeFileSync(path, contents, { flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

// The downloads a tab started, newest last, for its results and the tab listing. Start and end
// are reported through the tab's notices with the absolute path, so the agent never has to look
// for the file.
export class BrowserDownloads {
  private readonly items: Download[] = [];
  private readonly waiters = new Set<() => void>();

  track(item: DownloadItem, path: string, notify: (text: string) => void): void {
    const download: Download = {
      name: Path.basename(path),
      path,
      startedAt: Date.now(),
      state: "progressing",
      received: 0,
      total: item.getTotalBytes(),
    };
    this.items.push(download);
    if (this.items.length > MAX_KEPT) this.items.shift();
    for (const wake of [...this.waiters]) wake();
    notify(`Download started: ${download.name}, saving to ${path}.`);
    item.on("updated", () => {
      download.received = item.getReceivedBytes();
      download.total = item.getTotalBytes();
    });
    item.once("done", (_event, state) => {
      download.state = state;
      download.received = item.getReceivedBytes();
      notify(
        state === "completed"
          ? `Download finished: ${path} (${bytes(download.received)}).`
          : `The download of ${download.name} was ${state}; nothing was saved.`,
      );
      for (const wake of [...this.waiters]) wake();
    });
  }

  // Waits up to `capMs` for a download started since `since`.
  started(since: number, capMs: number): Promise<void> {
    return this.until(() => this.items.some((item) => item.startedAt >= since), capMs);
  }

  // Waits up to `capMs` for downloads started since `since` to end, so a quick one is reported
  // in the result of the action that started it.
  settle(since: number, capMs: number): Promise<void> {
    return this.until(
      () => !this.items.some((item) => item.startedAt >= since && item.state === "progressing"),
      capMs,
    );
  }

  private async until(done: () => boolean, capMs: number): Promise<void> {
    const deadline = Date.now() + capMs;
    while (!done() && Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        const wake = () => {
          clearTimeout(timer);
          this.waiters.delete(wake);
          resolve();
        };
        const timer = setTimeout(wake, deadline - Date.now());
        this.waiters.add(wake);
      });
    }
  }

  lines(): string[] {
    return this.items.map((item) => {
      if (item.state === "completed") return `${item.path} (${bytes(item.received)}), finished`;
      if (item.state !== "progressing") return `${item.path}, ${item.state}`;
      const progress =
        item.total > 0
          ? `${Math.round((item.received / item.total) * 100)}% of ${bytes(item.total)}`
          : `${bytes(item.received)} so far`;
      return `${item.path}, downloading (${progress})`;
    });
  }
}
