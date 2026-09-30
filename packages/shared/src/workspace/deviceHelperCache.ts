export const DEVICE_HELPER_CACHE_SEGMENTS = [
  "Library",
  "Caches",
  "glade",
  "device-helper",
] as const;

export const DEVICE_HELPER_BINARY_NAME = "glade-device-helper";

export const DEVICE_HELPER_SOURCE_DIR_ENV = "GLADE_DEVICE_HELPER_SOURCE_DIR";

export function deviceHelperCacheKey(
  xcodebuildVersionOutput: string,
  sourceRevision?: string,
): string | null {
  const version = /Xcode\s+([\d.]+)/u.exec(xcodebuildVersionOutput)?.[1];
  const build = /Build version\s+(\S+)/u.exec(xcodebuildVersionOutput)?.[1];
  if (!version && !build) return null;
  const toolchain = `${version ?? "unknown"}-${build ?? "unknown"}`;
  return sourceRevision ? `${toolchain}-${sourceRevision}` : toolchain;
}

// The toolchain alone is not enough. A cached binary stays valid for its Xcode version forever, so
// shipping a fix to the helper leaves every existing user running the binary they already built:
// the source changes, the key does not, and the rebuild never happens.
export interface DeviceHelperSourceFile {
  readonly name: string;
  readonly contents: string;
}

export function deviceHelperSourceRevision(files: readonly DeviceHelperSourceFile[]): string {
  // Name and contents both, so a rename is a change; sorted so directory order cannot make the same
  // tree hash two different ways.
  const canonical = [...files]
    .toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((file) => `${file.name}\0${file.contents}`)
    .join("\0");

  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// The server and smoke tool must derive the same cache key from source content. Inject reads to
// keep Node imports out of browser consumers.
export async function readDeviceHelperSourceRevision(
  helperSourceDir: string,
  io: {
    readonly listSources: (dir: string) => Promise<readonly string[]>;
    readonly readFile: (file: string) => Promise<string>;
    readonly join: (...parts: string[]) => string;
  },
): Promise<string | undefined> {
  const sourcesDir = io.join(helperSourceDir, "Sources");
  const names = await io.listSources(sourcesDir).catch(() => null);
  if (names === null) return undefined;

  const files = await Promise.all(
    names.map(async (name) => ({
      name,
      contents: await io.readFile(io.join(sourcesDir, name)).catch(() => ""),
    })),
  );

  const script = await io.readFile(io.join(helperSourceDir, "build.sh")).catch(() => "");
  return deviceHelperSourceRevision([...files, { name: "build.sh", contents: script }]);
}
