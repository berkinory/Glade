export function formatWorkspaceFileError(error: unknown): string {
  if (!(error instanceof Error)) return "Could not read file.";
  const detail = error.message.replace(/^workspaceFileSystem\.[\w]+ failed for .*?:\s*/u, "");
  if (/file appears to be binary/i.test(detail))
    return "This is a binary file. Open it in another app to view it.";
  if (/EISDIR|is a directory/i.test(detail))
    return "This is a folder. Select a file to preview it.";
  if (/ENOENT|no such file|not found/i.test(detail))
    return "This file no longer exists. Refresh Explorer to update the list.";
  if (/EACCES|EPERM|permission denied/i.test(detail))
    return "Glade doesn't have permission to read this file.";
  if (/too large|exceeds.*size|size limit/i.test(detail))
    return "This file is too large to preview.";
  return detail || "Could not read file.";
}
