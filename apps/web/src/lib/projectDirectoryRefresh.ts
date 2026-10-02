import type { QueryClient } from "@tanstack/react-query";

type DirectoryRefresh = { paths: Set<string>; promise: Promise<void> };
const refreshes = new WeakMap<QueryClient, Map<string, DirectoryRefresh>>();

export function refreshProjectDirectories(
  queryClient: QueryClient,
  cwd: string,
  paths: Iterable<string>,
): Promise<void> {
  let byCwd = refreshes.get(queryClient);
  if (!byCwd) {
    byCwd = new Map();
    refreshes.set(queryClient, byCwd);
  }
  const pending = byCwd.get(cwd);
  if (pending) {
    for (const path of paths) pending.paths.add(path === "." ? "" : path);
    return pending.promise;
  }
  const entry: DirectoryRefresh = {
    paths: new Set([...paths].map((path) => (path === "." ? "" : path))),
    promise: Promise.resolve(),
  };
  byCwd.set(cwd, entry);
  entry.promise = (async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 75));
    while (entry.paths.size > 0) {
      const changed = new Set(entry.paths);
      entry.paths.clear();
      await queryClient.invalidateQueries(
        {
          predicate: ({ queryKey }) => {
            if (queryKey[0] !== "projects" || queryKey[2] !== cwd) return false;
            if (queryKey[1] === "list-directories") return changed.has(String(queryKey[3] ?? ""));
            return (
              queryKey[1] === "search-entries" ||
              queryKey[1] === "search-content" ||
              queryKey[1] === "resolve-workspace-file-reference" ||
              queryKey[1] === "resolve-out-of-root-file-reference"
            );
          },
        },
        { cancelRefetch: false },
      );
    }
    if (byCwd.get(cwd) === entry) byCwd.delete(cwd);
  })().finally(() => {
    if (byCwd.get(cwd) === entry) byCwd.delete(cwd);
  });
  return entry.promise;
}
