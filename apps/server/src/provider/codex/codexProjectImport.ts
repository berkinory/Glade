import fs from "node:fs/promises";
import path from "node:path";
import { resolveBaseCodexHomePath } from "./codexHomePaths";
import type { NativeProjectImportCatalog } from "../core/projectImportTypes";
import type { ThreadListParams } from "./protocol/generated/types/v2/ThreadListParams";
import type { ThreadListResponse } from "./protocol/generated/types/v2/ThreadListResponse";
import type { ProjectListParams } from "./protocol/generated/types/v2/ProjectListParams";
import type { ProjectListResponse } from "./protocol/generated/types/v2/ProjectListResponse";

export async function resolveCodexProjectImportHome(
  input: { readonly homePath?: string; readonly env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  const home = resolveBaseCodexHomePath(input.env ?? process.env, input.homePath);
  try {
    return await fs.realpath(home);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return path.resolve(home);
    throw cause;
  }
}

export async function discoverCodexProjects(input: {
  readonly homePath?: string;
  readonly listThreads: (params: ThreadListParams) => Promise<ThreadListResponse>;
  readonly listProjects: (params: ProjectListParams) => Promise<ProjectListResponse>;
}): Promise<NativeProjectImportCatalog> {
  const projects: NativeProjectImportCatalog["projects"][number][] = [];
  const sessions: NativeProjectImportCatalog["sessions"][number][] = [];
  let cursor: string | undefined;
  const projectCursors = new Set<string>();
  do {
    const page = await input.listProjects({ cursor: cursor ?? null, limit: 100 });
    projects.push(
      ...page.data.map((project) => ({
        id: project.id,
        title: project.name,
        roots: project.roots.map((root) => root.path),
      })),
    );
    cursor = page.nextCursor ?? undefined;
    if (cursor && projectCursors.has(cursor))
      throw new Error("Codex repeated a project list cursor.");
    if (cursor) projectCursors.add(cursor);
  } while (cursor);
  for (const archived of [false, true]) {
    cursor = undefined;
    const threadCursors = new Set<string>();
    do {
      const page = await input.listThreads({
        cursor: cursor ?? null,
        limit: 100,
        archived,
        sourceKinds: ["cli", "vscode", "exec", "appServer", "unknown"],
        sortKey: "updated_at",
      });
      sessions.push(
        ...page.data.flatMap((thread) => {
          if (thread.ephemeral || thread.parentThreadId) return [];
          return [
            {
              id: thread.id,
              title: thread.name?.trim() || thread.preview.trim() || thread.id,
              cwd: thread.cwd,
              projectId: thread.projectId,
              createdAt: new Date(thread.createdAt * 1000).toISOString(),
              updatedAt: new Date(thread.updatedAt * 1000).toISOString(),
              archived,
            },
          ];
        }),
      );
      cursor = page.nextCursor ?? undefined;
      if (cursor && threadCursors.has(cursor))
        throw new Error("Codex repeated a thread list cursor.");
      if (cursor) threadCursors.add(cursor);
    } while (cursor);
  }
  return {
    sourceHome: await resolveCodexProjectImportHome(
      input.homePath ? { homePath: input.homePath } : {},
    ),
    projects,
    sessions,
  };
}
