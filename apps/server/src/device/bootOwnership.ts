import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import * as path from "node:path";

interface BootOwnershipFile {
  readonly version: 1;

  readonly pid: number;
  readonly udids: readonly string[];
}

export interface BootOwnershipStore {
  read(): Promise<{ readonly pid: number; readonly udids: readonly string[] } | null>;
  write(udids: readonly string[]): Promise<void>;
  clear(): Promise<void>;
}

export const NULL_BOOT_OWNERSHIP: BootOwnershipStore = {
  read: async () => null,
  write: async () => undefined,
  clear: async () => undefined,
};

export function makeBootOwnershipStore(
  filePath: string,
  processId: number = process.pid,
): BootOwnershipStore {
  const writeFileAtomically = async (contents: string): Promise<void> => {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${processId}.tmp`;
    await writeFile(temporaryPath, contents, "utf8");

    await rename(temporaryPath, filePath);
  };

  return {
    async read() {
      const raw = await readFile(filePath, "utf8").catch(() => null);
      if (raw === null) return null;
      try {
        const parsed = JSON.parse(raw) as Partial<BootOwnershipFile>;
        if (parsed.version !== 1 || !Array.isArray(parsed.udids)) return null;
        const udids = parsed.udids.filter((udid): udid is string => typeof udid === "string");
        return { pid: typeof parsed.pid === "number" ? parsed.pid : 0, udids };
      } catch {
        return null;
      }
    },

    async write(udids) {
      const file: BootOwnershipFile = { version: 1, pid: processId, udids: [...udids] };
      await writeFileAtomically(JSON.stringify(file)).catch(() => undefined);
    },

    async clear() {
      await writeFileAtomically(
        JSON.stringify({ version: 1, pid: processId, udids: [] } satisfies BootOwnershipFile),
      ).catch(() => undefined);
    },
  };
}

export function orphanedBootUdids(
  recorded: { readonly pid: number; readonly udids: readonly string[] } | null,
  bootedUdids: readonly string[],
  isProcessAlive: (pid: number) => boolean,
): readonly string[] {
  if (recorded === null || recorded.udids.length === 0) return [];
  if (recorded.pid > 0 && isProcessAlive(recorded.pid)) return [];
  const booted = new Set(bootedUdids);
  return recorded.udids.filter((udid) => booted.has(udid));
}

export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
