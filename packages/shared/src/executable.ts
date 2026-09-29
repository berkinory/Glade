import { accessSync, constants, readdirSync, statSync } from "node:fs";
import { extname, join, posix, win32 } from "node:path";

export interface ExecutableLookupOptions {
  readonly platform?: NodeJS.Platform | undefined;

  readonly env?: NodeJS.ProcessEnv | undefined;

  readonly cwd?: string;
  // Off by default because Windows native process creation will not execute an extensionless
  // npm-style shim.
  readonly allowExtensionlessOnWindows?: boolean;
}

export interface ExecutableCandidate {
  readonly directory: string;
  readonly path: string;
}

const DEFAULT_WINDOWS_PATH_EXTENSIONS: readonly string[] = [".COM", ".EXE", ".BAT", ".CMD"];
const DEFAULT_POSIX_PATH_ENTRIES: readonly string[] = ["/usr/bin", "/bin"];
const WINDOWS_DIRECT_LAUNCH_EXTENSIONS = new Set(DEFAULT_WINDOWS_PATH_EXTENSIONS);

export function envPathKeyFor(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): "PATH" | "Path" | "path" {
  if ("PATH" in env) return "PATH";
  if ("Path" in env) return "Path";
  if ("path" in env) {
    return platform === "win32" ? "path" : "PATH";
  }
  return "PATH";
}

export function hasPathSeparator(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

export function windowsPathExtensions(env: NodeJS.ProcessEnv): readonly string[] {
  const rawValue = env.PATHEXT;
  if (!rawValue) return DEFAULT_WINDOWS_PATH_EXTENSIONS;

  const parsed = rawValue
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => (entry.startsWith(".") ? entry.toUpperCase() : `.${entry.toUpperCase()}`));
  return parsed.length > 0 ? [...new Set(parsed)] : DEFAULT_WINDOWS_PATH_EXTENSIONS;
}

export function pathEntries(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const pathValue = env.PATH ?? env.Path ?? env.path;
  if (pathValue === undefined) {
    return platform === "win32" ? [] : [...DEFAULT_POSIX_PATH_ENTRIES];
  }
  if (pathValue.length === 0) return [];
  return pathValue
    .split(platform === "win32" ? ";" : ":")
    .map((entry) => entry.trim().replace(/^"+|"+$/g, ""))
    .filter((entry) => entry.length > 0);
}

export function executableNameCandidates(
  command: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  allowExtensionless = false,
): readonly string[] {
  if (platform !== "win32") return [command];

  const pathExtensions = windowsPathExtensions(env);
  const extension = extname(command);
  const normalizedExtension = extension.toUpperCase();

  if (
    extension.length > 0 &&
    (pathExtensions.includes(normalizedExtension) ||
      WINDOWS_DIRECT_LAUNCH_EXTENSIONS.has(normalizedExtension))
  ) {
    const stem = command.slice(0, -extension.length);
    return [
      ...new Set([
        command,
        `${stem}${normalizedExtension}`,
        `${stem}${normalizedExtension.toLowerCase()}`,
      ]),
    ];
  }

  const candidates = allowExtensionless ? [command] : [];
  for (const pathExtension of pathExtensions) {
    candidates.push(`${command}${pathExtension}`, `${command}${pathExtension.toLowerCase()}`);
  }
  return [...new Set(candidates)];
}

function directoryOf(commandPath: string): string {
  const lastIndex = Math.max(commandPath.lastIndexOf("/"), commandPath.lastIndexOf("\\"));
  if (lastIndex < 0) return ".";
  if (lastIndex === 0) return commandPath.slice(0, 1);
  return commandPath.slice(0, lastIndex);
}

interface ExecutableLookupContext {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string | undefined;
  readonly pathExtensions: readonly string[];
}

function resolveLookupContext(options: ExecutableLookupOptions): ExecutableLookupContext {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  return {
    platform,
    env,
    cwd: options.cwd,
    pathExtensions: platform === "win32" ? windowsPathExtensions(env) : [],
  };
}

function candidateStatPath(filePath: string, context: ExecutableLookupContext): string {
  const pathModule = context.platform === "win32" ? win32 : posix;
  if (pathModule.isAbsolute(filePath)) return filePath;
  return pathModule.resolve(context.cwd ?? process.cwd(), filePath);
}

function* candidatesIn(
  command: string,
  context: ExecutableLookupContext,
  allowExtensionless: boolean,
): Generator<ExecutableCandidate> {
  const names = executableNameCandidates(
    command,
    context.platform,
    context.env,
    allowExtensionless,
  );

  if (hasPathSeparator(command)) {
    for (const name of names) {
      yield { directory: directoryOf(name), path: name };
    }
    return;
  }

  for (const directory of pathEntries(context.env, context.platform)) {
    for (const name of names) {
      yield { directory, path: join(directory, name) };
    }
  }
}

export function executableCandidates(
  command: string,
  options: ExecutableLookupOptions = {},
): Generator<ExecutableCandidate> {
  return candidatesIn(
    command,
    resolveLookupContext(options),
    options.allowExtensionlessOnWindows ?? false,
  );
}

function isExecutableFileIn(filePath: string, context: ExecutableLookupContext): boolean {
  const statPath = candidateStatPath(filePath, context);
  try {
    if (!statSync(statPath).isFile()) return false;
    if (context.platform === "win32") {
      const extension = extname(filePath).toUpperCase();
      return (
        extension.length > 0 &&
        (context.pathExtensions.includes(extension) ||
          WINDOWS_DIRECT_LAUNCH_EXTENSIONS.has(extension))
      );
    }
    accessSync(statPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function isExecutableFile(filePath: string, options: ExecutableLookupOptions = {}): boolean {
  return isExecutableFileIn(filePath, resolveLookupContext(options));
}

export function resolveExecutable(
  command: string,
  options: ExecutableLookupOptions = {},
): string | null {
  const context = resolveLookupContext(options);
  for (const candidate of candidatesIn(
    command,
    context,
    options.allowExtensionlessOnWindows ?? false,
  )) {
    if (isExecutableFileIn(candidate.path, context)) {
      return candidate.path;
    }
  }
  return null;
}

function listDirectoryNames(directory: string): ReadonlySet<string> | null {
  try {
    return new Set(readdirSync(directory).map((name) => name.toLowerCase()));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? new Set() : null;
  }
}

// The listing is folded with `toLowerCase`, which matches filesystem case-insensitivity only for
// plain ASCII; non-ASCII names (Unicode folding/normalization) and `~` (Windows 8.3 short names,
// which readdir never lists) always go to stat.
function isListingFilterable(name: string): boolean {
  return /^[\x20-\x7d]*$/.test(name);
}

export function createBatchExecutableResolver(
  options: ExecutableLookupOptions = {},
): (command: string) => string | null {
  const context = resolveLookupContext(options);
  const allowExtensionless = options.allowExtensionlessOnWindows ?? false;
  const listings = new Map<string, ReadonlySet<string> | null>();
  const listingFor = (directory: string) => {
    const statPath = candidateStatPath(directory, context);
    let listing = listings.get(statPath);
    if (listing === undefined) {
      listing = listDirectoryNames(statPath);
      listings.set(statPath, listing);
    }
    return listing;
  };

  return (command) => {
    if (hasPathSeparator(command)) {
      return resolveExecutable(command, options);
    }
    const names = executableNameCandidates(
      command,
      context.platform,
      context.env,
      allowExtensionless,
    );

    for (const directory of pathEntries(context.env, context.platform)) {
      const listing = listingFor(directory);
      for (const name of names) {
        if (listing !== null && isListingFilterable(name) && !listing.has(name.toLowerCase())) {
          continue;
        }
        const candidatePath = join(directory, name);
        if (isExecutableFileIn(candidatePath, context)) {
          return candidatePath;
        }
      }
    }
    return null;
  };
}

export function executableIdentity(filePath: string): string | null {
  try {
    const stats = statSync(filePath);
    return `${stats.size}:${stats.mtimeMs}`;
  } catch {
    return null;
  }
}
