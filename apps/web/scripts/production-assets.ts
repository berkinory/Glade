import fs from "node:fs/promises";
import path from "node:path";

export async function listFiles(root: string): Promise<string[]> {
  const entries = await fs
    .readdir(root, { withFileTypes: true })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
  const files: string[] = [];
  for (const entry of entries) {
    const name = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(name)));
    else if (entry.isFile()) files.push(name);
  }
  return files;
}
