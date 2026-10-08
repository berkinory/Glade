import type { DesktopSshDiscoveredHost } from "@glade/contracts/ipc/sshHosts";
import { expandHomePath } from "@glade/shared/platform/gladeHome";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

const MAX_INCLUDE_DEPTH = 16;
const MAX_HOSTS = 200;

function readText(path: string): string | null {
  try {
    return FS.readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^${escaped.replaceAll("*", ".*").replaceAll("?", ".")}$`, "u");
}

// ssh_config Include paths are relative to ~/.ssh and may end in a glob such as `config.d/*`.
function resolveIncludes(argument: string, sshDir: string): string[] {
  return argument.split(/\s+/u).flatMap((raw) => {
    const expanded = expandHomePath(raw);
    const path = Path.isAbsolute(expanded) ? expanded : Path.join(sshDir, expanded);
    const base = Path.basename(path);
    if (!/[*?]/u.test(base)) return [path];
    const matcher = globToRegExp(base);
    try {
      return FS.readdirSync(Path.dirname(path))
        .filter((entry) => matcher.test(entry))
        .toSorted()
        .map((entry) => Path.join(Path.dirname(path), entry));
    } catch {
      return [];
    }
  });
}

function collectConfigHosts(
  path: string,
  sshDir: string,
  depth: number,
  seenFiles: Set<string>,
  hosts: Set<string>,
): void {
  if (depth > MAX_INCLUDE_DEPTH || seenFiles.has(path)) return;
  seenFiles.add(path);
  const text = readText(path);
  if (text === null) return;
  for (const line of text.split("\n")) {
    const match = /^\s*(host|include)\s+(.+?)\s*$/iu.exec(line);
    if (!match) continue;
    const [, keyword = "", argument = ""] = match;
    if (keyword.toLowerCase() === "include") {
      for (const included of resolveIncludes(argument, sshDir)) {
        collectConfigHosts(included, sshDir, depth + 1, seenFiles, hosts);
      }
      continue;
    }
    // Patterns and negations describe groups of hosts, not a destination someone can pick.
    for (const alias of argument.split(/\s+/u)) {
      if (!/[*?!]/u.test(alias)) hosts.add(alias);
    }
  }
}

function collectKnownHosts(path: string, hosts: Set<string>): void {
  const text = readText(path);
  if (text === null) return;
  for (const line of text.split("\n")) {
    const field = line.trim().split(/\s+/u)[0] ?? "";
    // Hashed entries cannot be read back, and bracketed ones need a non-default port.
    if (
      field.length === 0 ||
      field.startsWith("#") ||
      field.startsWith("|") ||
      field.startsWith("@")
    )
      continue;
    for (const name of field.split(",")) {
      if (name.length > 0 && !name.startsWith("[")) hosts.add(name);
    }
  }
}

export function discoverSshHosts(): DesktopSshDiscoveredHost[] {
  const sshDir = Path.join(OS.homedir(), ".ssh");
  const configHosts = new Set<string>();
  collectConfigHosts(Path.join(sshDir, "config"), sshDir, 0, new Set(), configHosts);
  const knownHosts = new Set<string>();
  collectKnownHosts(Path.join(sshDir, "known_hosts"), knownHosts);
  const discovered: DesktopSshDiscoveredHost[] = [
    ...[...configHosts].map((alias) => ({ alias, source: "ssh-config" as const })),
    ...[...knownHosts]
      .filter((alias) => !configHosts.has(alias))
      .map((alias) => ({ alias, source: "known-hosts" as const })),
  ];
  return discovered.slice(0, MAX_HOSTS);
}
