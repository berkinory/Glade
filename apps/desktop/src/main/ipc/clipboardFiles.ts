import { clipboard } from "electron";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execProcessFile, spawnProcess } from "@glade/shared/platform/processRuntime";
import { resolveWindowsPowerShellExecutable } from "@glade/shared/platform/platformEnvironment";
import type { DesktopClipboardFile } from "@glade/contracts/ipc/ipc";

async function macFilePaths(): Promise<string[]> {
  const buffer = clipboard.readBuffer("NSFilenamesPboardType");
  if (buffer.length === 0) return [];
  if (buffer.length > 1024 * 1024) throw new Error("Too many clipboard files.");
  const json = await new Promise<string>((resolve, reject) => {
    const child = spawnProcess("/usr/bin/plutil", ["-convert", "json", "-o", "-", "-"], {
      stdio: "pipe",
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Clipboard file reading timed out."));
    }, 3000);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.resume();
    child.stdin.on("error", reject);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error("Could not read the file list from the clipboard."));
    });
    child.stdin.end(buffer);
  });
  return parseFilePaths(json);
}

function parseFilePaths(json: string): string[] {
  const parsed: unknown = JSON.parse(json);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((value): value is string => typeof value === "string")
  )
    throw new Error("Invalid clipboard file list.");
  return parsed;
}

async function windowsFilePaths(): Promise<string[]> {
  // Electron's raw-format API registers names, so it cannot address the predefined CF_HDROP id.
  const script =
    "$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Windows.Forms; ConvertTo-Json -InputObject @([System.Windows.Forms.Clipboard]::GetFileDropList()) -Compress";
  const json = await new Promise<string>((resolve, reject) => {
    execProcessFile(
      resolveWindowsPowerShellExecutable(),
      ["-NoProfile", "-NonInteractive", "-STA", "-Command", script],
      { encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
  return parseFilePaths(json);
}

export async function readDesktopClipboardFiles(): Promise<DesktopClipboardFile[]> {
  let paths: string[] = [];
  if (process.platform === "darwin") paths = await macFilePaths();
  if (process.platform === "win32") paths = await windowsFilePaths();
  if (paths.length === 0) {
    const text =
      clipboard.read("text/uri-list") ||
      clipboard.read("x-special/gnome-copied-files") ||
      clipboard.read("public.file-url");
    paths = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("file://"))
      .map((url) => fileURLToPath(url));
  }
  if (paths.length > 512) throw new Error("Paste at most 512 files at once.");
  return Promise.all(
    [...new Set(paths)].map(async (filePath) => {
      if (!path.isAbsolute(filePath)) throw new Error("Invalid clipboard file path.");
      const stat = await fs.lstat(filePath);
      if (!stat.isFile() && !stat.isDirectory())
        throw new Error("Paste regular files or folders, not symbolic links.");
      return {
        path: filePath,
        name: path.basename(filePath),
        kind: stat.isDirectory() ? ("directory" as const) : ("file" as const),
      };
    }),
  );
}
