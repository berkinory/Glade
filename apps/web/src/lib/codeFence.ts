import { getFiletypeFromFileName } from "@pierre/diffs";
import { basenameOfPath } from "../file-icons";

export interface CodeFenceInfo {
  readonly language: string;

  readonly isFileReference: boolean;

  readonly filePath: string | null;

  readonly fileName: string | null;

  readonly directory: string | null;

  readonly lineRange: string | null;
}

function directoryFromPath(filePath: string, fileName: string): string | null {
  const dir = filePath.slice(0, Math.max(0, filePath.length - fileName.length));
  const trimmed = dir.replace(/[\\/]+$/, "");
  return trimmed.length > 0 ? trimmed : null;
}

function fileReferenceInfo(filePath: string, lineRange: string | null): CodeFenceInfo {
  const fileName = basenameOfPath(filePath);
  return {
    language: getFiletypeFromFileName(fileName),
    isFileReference: true,
    filePath,
    fileName,
    directory: directoryFromPath(filePath, fileName),
    lineRange,
  };
}

const LEADING_WHITESPACE_REGEX = /^[ \t]*/;

export function dedentCode(code: string): string {
  const lines = code.split("\n");
  let minIndent = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const indent = LEADING_WHITESPACE_REGEX.exec(line)?.[0].length ?? 0;
    if (indent < minIndent) minIndent = indent;
  }
  if (!Number.isFinite(minIndent) || minIndent === 0) {
    return code;
  }
  return lines.map((line) => line.slice(minIndent)).join("\n");
}

const CODE_REFERENCE_REGEX = /^(\d+):(\d+):(.+)$/;

export function parseCodeFenceInfo(rawInfo: string): CodeFenceInfo {
  const info = rawInfo.trim();

  const referenceMatch = info.match(CODE_REFERENCE_REGEX);
  if (referenceMatch) {
    const [, start, end, filePath] = referenceMatch;
    if (start != null && end != null && filePath != null) {
      const lineRange = start === end ? start : `${start}-${end}`;
      return fileReferenceInfo(filePath, lineRange);
    }
  }

  if (info.includes("/") || info.includes("\\")) {
    return fileReferenceInfo(info, null);
  }

  const language = info === "gitignore" ? "ini" : info.length > 0 ? info : "text";
  return {
    language,
    isFileReference: false,
    filePath: null,
    fileName: null,
    directory: null,
    lineRange: null,
  };
}
