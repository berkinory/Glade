import { Effect, FileSystem, Layer, Path } from "effect";

import {
  ProjectFaviconResolver,
  type ProjectFaviconResolverShape,
} from "../Services/ProjectFaviconResolver";

const FAVICON_CANDIDATES = [
  "favicon.svg",
  "favicon.ico",
  "favicon.png",
  "public/favicon.svg",
  "public/favicon.ico",
  "public/favicon.png",
  "app/favicon.ico",
  "app/favicon.png",
  "app/icon.svg",
  "app/icon.png",
  "app/icon.ico",
  "src/favicon.ico",
  "src/favicon.svg",
  "src/app/favicon.ico",
  "src/app/icon.svg",
  "src/app/icon.png",
  "assets/icon.svg",
  "assets/icon.png",
  "assets/logo.svg",
  "assets/logo.png",
] as const;

const ICON_SOURCE_FILES = [
  "index.html",
  "public/index.html",
  "app/routes/__root.tsx",
  "src/routes/__root.tsx",
  "app/root.tsx",
  "src/root.tsx",
  "src/index.html",
] as const;

const LINK_ICON_HTML_RE =
  /<link\b(?=[^>]*\brel=["'](?:icon|shortcut icon)["'])(?=[^>]*\bhref=["']([^"'?]+))[^>]*>/i;
const LINK_ICON_OBJ_RE =
  /(?=[^}]*\brel\s*:\s*["'](?:icon|shortcut icon)["'])(?=[^}]*\bhref\s*:\s*["']([^"'?]+))[^}]*/i;

function extractIconHref(source: string): string | null {
  const htmlMatch = source.match(LINK_ICON_HTML_RE);
  if (htmlMatch?.[1]) return htmlMatch[1];
  const objMatch = source.match(LINK_ICON_OBJ_RE);
  if (objMatch?.[1]) return objMatch[1];
  return null;
}

const makeProjectFaviconResolver = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const resolveIconHref = (projectCwd: string, href: string): string[] => {
    const clean = href.replace(/^\//, "");
    return [path.join(projectCwd, "public", clean), path.join(projectCwd, clean)];
  };

  const isPathWithinProject = (projectCwd: string, candidatePath: string): boolean => {
    const relative = path.relative(path.resolve(projectCwd), path.resolve(candidatePath));
    return (
      relative === "" ||
      (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
  };

  const findExistingFile = Effect.fn(function* (
    projectCwd: string,
    candidates: ReadonlyArray<string>,
    maxBytes = 512 * 1024,
  ) {
    for (const candidate of candidates) {
      if (!isPathWithinProject(projectCwd, candidate)) {
        continue;
      }
      const realPath = yield* fileSystem
        .realPath(candidate)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (!realPath || !isPathWithinProject(projectCwd, realPath)) continue;
      const stats = yield* fileSystem.stat(realPath).pipe(Effect.catch(() => Effect.succeed(null)));
      if (stats?.type === "File" && Number(stats.size) <= maxBytes) {
        return realPath;
      }
    }
    return null;
  });

  const resolveInDirectory = Effect.fn(function* (root: string, directory: string) {
    const conventional = yield* findExistingFile(
      root,
      FAVICON_CANDIDATES.map((name) => path.join(directory, name)),
    );
    if (conventional) return conventional;
    for (const name of ICON_SOURCE_FILES) {
      const sourcePath = yield* findExistingFile(root, [path.join(directory, name)], 256 * 1024);
      if (!sourcePath) continue;
      const source = yield* fileSystem
        .readFileString(sourcePath)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      const href = source ? extractIconHref(source) : null;
      if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) continue;
      const existing = yield* findExistingFile(root, resolveIconHref(directory, href));
      if (existing) return existing;
    }
    return null;
  });

  const resolvePath: ProjectFaviconResolverShape["resolvePath"] = Effect.fn(function* (cwd) {
    const root = yield* fileSystem.realPath(cwd).pipe(Effect.catch(() => Effect.succeed(null)));
    if (!root) return null;
    const rootIcon = yield* resolveInDirectory(root, root);
    if (rootIcon) return rootIcon;
    const directories = new Set(["apps/web", "web", "frontend", "client", "site"]);
    for (const parent of ["apps", "packages"]) {
      const directory = yield* fileSystem
        .realPath(path.join(root, parent))
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (!directory || !isPathWithinProject(root, directory)) continue;
      const names = yield* fileSystem
        .readDirectory(directory)
        .pipe(Effect.catch(() => Effect.succeed([] as string[])));
      for (const name of names.toSorted().slice(0, 12)) directories.add(path.join(parent, name));
    }
    for (const directory of directories) {
      const icon = yield* resolveInDirectory(root, path.join(root, directory));
      if (icon) return icon;
    }
    return null;
  });

  return { resolvePath } satisfies ProjectFaviconResolverShape;
});

export const ProjectFaviconResolverLive = Layer.effect(
  ProjectFaviconResolver,
  makeProjectFaviconResolver,
);
