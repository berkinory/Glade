import {
  LOCAL_IMAGE_ROUTE_PATH,
  SUPPORTED_LOCAL_IMAGE_EXTENSION_REGEX,
} from "@glade/shared/browser/localPreviewFiles";
import { isLocalAbsolutePath, isWindowsAbsolutePath } from "@glade/shared/platform/path";

import { resolveWsHttpUrl } from "./wsHttpUrl";

function normalizeMarkdownImagePath(src: string): string {
  const trimmed = src.trim();
  if (trimmed.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(trimmed).pathname);
    } catch {
      return trimmed;
    }
  }
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

export function isLocalImageMarkdownSrc(src: string | undefined): src is string {
  if (!src) {
    return false;
  }
  const normalized = normalizeMarkdownImagePath(src);
  if (!SUPPORTED_LOCAL_IMAGE_EXTENSION_REGEX.test(normalized)) {
    return false;
  }
  // Treat Windows-style absolute paths (e.g. `C:\foo\bar.png`) as local images even though their
  // drive prefix would otherwise look like a URI scheme.
  if (isWindowsAbsolutePath(normalized)) {
    return true;
  }
  return (
    normalized.startsWith("/") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    !/^[a-z][a-z0-9+.-]*:/i.test(normalized)
  );
}

export function localImageAbsolutePath(src: string): string | null {
  const normalized = normalizeMarkdownImagePath(src);
  return isLocalImageMarkdownSrc(src) && isLocalAbsolutePath(normalized) ? normalized : null;
}

export function buildLocalImageUrl(input: {
  readonly src: string;
  readonly cwd: string | undefined;
  readonly download?: boolean;

  readonly grant?: string | null | undefined;

  readonly cacheKey?: string | number | undefined;
}): string {
  const params = new URLSearchParams({ path: normalizeMarkdownImagePath(input.src) });
  if (input.cwd) {
    params.set("cwd", input.cwd);
  }
  if (input.grant) {
    params.set("grant", input.grant);
  }
  if (input.cacheKey !== undefined) {
    params.set("v", String(input.cacheKey));
  }
  if (input.download) {
    params.set("download", "1");
  }

  return resolveWsHttpUrl(`${LOCAL_IMAGE_ROUTE_PATH}?${params.toString()}`);
}

export function localImageFileName(src: string): string {
  const normalized = normalizeMarkdownImagePath(src);
  const slash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}
