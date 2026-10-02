import {
  PROJECT_IMPORT_CONTENT_MAX_BYTES,
  type ProjectImportSource,
} from "@glade/contracts/workspace/project";
import { resolveDroppedFileAbsolutePath, isDroppedComposerDirectory } from "./composerDropPaths";

export type ExplorerImport = {
  name: string;
  kind: "file" | "directory";
  source: ProjectImportSource;
};

export async function explorerImportFromFile(
  file: File,
  directory = false,
): Promise<ExplorerImport> {
  const path = resolveDroppedFileAbsolutePath(file);
  const name =
    file.name ||
    `pasted-${crypto.randomUUID()}${file.type === "image/png" ? ".png" : file.type === "image/jpeg" ? ".jpg" : ".bin"}`;
  if (path) return { name, kind: directory ? "directory" : "file", source: { type: "path", path } };
  if (directory) throw new Error("Folder imports require the desktop app.");
  if (file.size > PROJECT_IMPORT_CONTENT_MAX_BYTES)
    throw new Error(
      "This clipboard attachment is too large. Drop the original file from your file manager instead.",
    );
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the attachment."));
    reader.onload = () => {
      if (typeof reader.result !== "string")
        return reject(new Error("Could not read the attachment."));
      resolve(reader.result.slice(reader.result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
  return { name, kind: "file", source: { type: "contents", base64 } };
}

export function collectExplorerDropFiles(data: DataTransfer): { file: File; directory: boolean }[] {
  const items = Array.from(data.items).filter((item) => item.kind === "file");
  return Array.from(data.files).map((file, index) => ({
    file,
    directory: isDroppedComposerDirectory(items[index]),
  }));
}
