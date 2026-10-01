import iconTheme from "./symbol-icon-theme.json";

const fileNames = new Map(
  Object.entries(iconTheme.fileNames).map(([name, icon]) => [name.toLowerCase(), icon]),
);
const fileExtensions = new Map(
  Object.entries(iconTheme.fileExtensions).map(([extension, icon]) => [
    extension.toLowerCase(),
    icon,
  ]),
);
const folderNames = new Map(
  Object.entries(iconTheme.folderNames).map(([name, icon]) => [name.toLowerCase(), icon]),
);

const mimeIcons = new Map<string, string>([
  ["application/pdf", "pdf"],
  ["application/json", "brackets-yellow"],
  ["application/xml", "xml"],
  ["application/zip", "compressed"],
  ["application/gzip", "compressed"],
  ["application/x-tar", "compressed"],
  ["application/x-7z-compressed", "compressed"],
  ["text/calendar", "document"],
  ["text/csv", "csv"],
  ["text/tab-separated-values", "csv"],
  ["text/markdown", "markdown"],
  ["text/html", "code-orange"],
  ["text/xml", "xml"],
]);

export function basenameOfPath(pathValue: string): string {
  const slashIndex = Math.max(pathValue.lastIndexOf("/"), pathValue.lastIndexOf("\\"));
  return slashIndex === -1 ? pathValue : pathValue.slice(slashIndex + 1);
}

function extensionCandidates(fileName: string): string[] {
  const candidates: string[] = [];
  let dotIndex = fileName.indexOf(".");
  while (dotIndex !== -1 && dotIndex < fileName.length - 1) {
    candidates.push(fileName.slice(dotIndex + 1));
    dotIndex = fileName.indexOf(".", dotIndex + 1);
  }
  return candidates;
}

function fileIconDefinition(pathValue: string): string | undefined {
  const basename = basenameOfPath(pathValue).toLowerCase();
  const byName = fileNames.get(basename);
  if (byName) return byName;
  for (const extension of extensionCandidates(basename)) {
    const byExtension = fileExtensions.get(extension);
    if (byExtension) return byExtension;
  }
  return undefined;
}

export function pathLooksLikeKnownFile(pathValue: string): boolean {
  return fileIconDefinition(pathValue) !== undefined;
}

export function inferEntryKindFromPath(pathValue: string): "file" | "directory" {
  const basename = basenameOfPath(pathValue);
  if (pathLooksLikeKnownFile(pathValue)) return "file";
  if (basename.startsWith(".") && !basename.slice(1).includes(".")) return "directory";
  return basename.includes(".") ? "file" : "directory";
}

function iconUrl(definition: string): string {
  const iconPath =
    iconTheme.iconDefinitions[definition as keyof typeof iconTheme.iconDefinitions]?.iconPath;
  return `/symbols/${iconPath?.replace(/^\.\/icons\//, "") ?? "files/document.svg"}`;
}

export function getFileIconUrl(pathValue: string): string {
  return iconUrl(fileIconDefinition(pathValue) ?? iconTheme.file);
}

export function getFolderIconUrl(pathValue: string): string {
  const basename = basenameOfPath(pathValue).toLowerCase();
  return iconUrl(folderNames.get(basename) ?? iconTheme.folder);
}

export function getAttachmentIconUrl(attachment: {
  name: string;
  mimeType?: string | null;
}): string {
  const byName = fileIconDefinition(attachment.name);
  if (byName) return iconUrl(byName);

  const mimeType = attachment.mimeType?.trim().toLowerCase() ?? "";
  const byMime = mimeIcons.get(mimeType);
  if (byMime) return iconUrl(byMime);
  const topLevelType = mimeType.split("/")[0];
  if (topLevelType === "image" || topLevelType === "audio" || topLevelType === "video") {
    return iconUrl(topLevelType);
  }
  if (topLevelType === "text") return iconUrl("text");
  return iconUrl(iconTheme.file);
}
