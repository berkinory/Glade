import * as fs from "node:fs/promises";
import * as nodePath from "node:path";

import type { ProviderKind } from "@glade/contracts/core/baseSchemas";
import type { ProviderSkillDescriptor } from "@glade/contracts/provider/providerDiscovery";
import { BUILT_IN_PROVIDERS, serverProviderDescriptor } from "../builtInProviders.ts";
import {
  type FrontmatterValue,
  parseSkillFrontmatter,
  readSkillFileHead,
} from "./skillFrontmatter.ts";

interface SkillRoot {
  readonly path: string;
  readonly scope: string;
  readonly includeMarkdownFiles?: boolean;

  readonly namespace?: string;

  readonly followSymlinks?: boolean;
}

function readStringField(
  frontmatter: Record<string, FrontmatterValue>,
  keys: ReadonlyArray<string>,
): string | undefined {
  for (const key of keys) {
    const value = frontmatter[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function readBooleanField(
  frontmatter: Record<string, FrontmatterValue>,
  keys: ReadonlyArray<string>,
): boolean | undefined {
  for (const key of keys) {
    const value = frontmatter[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

function ancestorsFromDeepest(cwd: string): string[] {
  const resolved = nodePath.resolve(cwd);
  const ancestors: string[] = [];
  let current = resolved;
  while (true) {
    ancestors.push(current);
    const parent = nodePath.dirname(current);
    if (parent === current) {
      return ancestors;
    }
    current = parent;
  }
}

async function readdirOrEmpty(path: string): Promise<import("node:fs").Dirent[]> {
  try {
    return await fs.readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function isWalkableSkillDirectory(
  parentPath: string,
  dirent: import("node:fs").Dirent,
  followSymlinks: boolean,
): Promise<boolean> {
  if (dirent.isDirectory()) {
    return true;
  }
  if (!followSymlinks || !dirent.isSymbolicLink()) {
    return false;
  }
  try {
    return (await fs.stat(nodePath.join(parentPath, dirent.name))).isDirectory();
  } catch {
    return false;
  }
}

async function isReadableMarkdownFile(
  parentPath: string,
  dirent: import("node:fs").Dirent,
): Promise<boolean> {
  if (!dirent.name.toLowerCase().endsWith(".md") || dirent.name.toLowerCase() === "skill.md") {
    return false;
  }
  if (dirent.isFile()) {
    return true;
  }
  if (!dirent.isSymbolicLink()) {
    return false;
  }
  try {
    return (await fs.stat(nodePath.join(parentPath, dirent.name))).isFile();
  } catch {
    return false;
  }
}

async function collectSkillMarkdownPaths(
  rootPath: string,
  options?: {
    readonly includeMarkdownFiles?: boolean;
    readonly followSymlinks?: boolean;
  },
): Promise<string[]> {
  async function visit(dir: string, depth: number): Promise<string[]> {
    const skillPath = nodePath.join(dir, "SKILL.md");
    try {
      const stat =
        options?.followSymlinks === false ? await fs.lstat(skillPath) : await fs.stat(skillPath);
      if (stat.isFile()) {
        return [skillPath];
      }
    } catch {}

    if (depth >= 2) {
      return [];
    }

    const dirents = await readdirOrEmpty(dir);
    const directMarkdownFiles =
      depth === 0 && options?.includeMarkdownFiles
        ? (
            await Promise.all(
              dirents.map(async (dirent) => ({
                name: dirent.name,
                isMarkdownFile: await isReadableMarkdownFile(dir, dirent),
              })),
            )
          )
            .filter((entry) => entry.isMarkdownFile)
            .map((entry) => nodePath.join(dir, entry.name))
            .toSorted()
        : [];
    const subdirNames = (
      await Promise.all(
        dirents.map(async (dirent) => ({
          name: dirent.name,
          isDirectory: await isWalkableSkillDirectory(
            dir,
            dirent,
            options?.followSymlinks !== false,
          ),
        })),
      )
    )
      .filter((entry) => entry.isDirectory)
      .map((entry) => entry.name)
      .toSorted();
    const nested = await Promise.all(
      subdirNames.map((name) => visit(nodePath.join(dir, name), depth + 1)),
    );
    return [...directMarkdownFiles, ...nested.flat()];
  }

  return visit(rootPath, 0);
}

async function readSkillDescriptor(input: {
  readonly skillPath: string;
  readonly scope: string;
  readonly namespace?: string;
}): Promise<ProviderSkillDescriptor | null> {
  let raw: string;
  try {
    raw = await readSkillFileHead(input.skillPath);
  } catch {
    return null;
  }

  const frontmatter = parseSkillFrontmatter(raw);
  const skillFilename = nodePath.basename(input.skillPath);
  const fallbackName =
    skillFilename.toLowerCase() === "skill.md"
      ? nodePath.basename(nodePath.dirname(input.skillPath))
      : nodePath.basename(input.skillPath, nodePath.extname(input.skillPath));
  const unqualifiedName = readStringField(frontmatter, ["name"]) ?? fallbackName;
  const name =
    input.namespace && !unqualifiedName.includes(":")
      ? `${input.namespace}:${unqualifiedName}`
      : unqualifiedName;
  const description = readStringField(frontmatter, ["description"]);
  const displayName = readStringField(frontmatter, ["display-name", "displayName", "title"]);
  const shortDescription = readStringField(frontmatter, [
    "short-description",
    "shortDescription",
    "summary",
  ]);
  const disabled =
    readBooleanField(frontmatter, ["disable-model-invocation", "disableModelInvocation"]) === true;

  return {
    name,
    ...(description ? { description } : {}),
    path: input.skillPath,
    enabled: !disabled,
    scope: input.scope,
    ...(displayName || shortDescription
      ? {
          interface: {
            ...(displayName ? { displayName } : {}),
            ...(shortDescription ? { shortDescription } : {}),
          },
        }
      : {}),
  };
}

function skillNameKey(name: string): string {
  return name.trim().toLowerCase();
}

async function collectSkillDescriptorsFromRoots(
  roots: ReadonlyArray<SkillRoot>,
): Promise<ProviderSkillDescriptor[]> {
  const skillsPerRoot = await Promise.all(
    roots.map(async (root) => {
      const skillPaths = await collectSkillMarkdownPaths(
        root.path,
        root.includeMarkdownFiles || root.followSymlinks === false
          ? {
              ...(root.includeMarkdownFiles ? { includeMarkdownFiles: true } : {}),
              ...(root.followSymlinks === false ? { followSymlinks: false } : {}),
            }
          : undefined,
      );
      const descriptors = await Promise.all(
        skillPaths.map((skillPath) =>
          readSkillDescriptor({
            skillPath,
            scope: root.scope,
            ...(root.namespace ? { namespace: root.namespace } : {}),
          }),
        ),
      );
      return descriptors.filter((skill) => skill !== null);
    }),
  );
  return skillsPerRoot.flat();
}

async function collectSkillsFromRoots(
  roots: ReadonlyArray<SkillRoot>,
): Promise<ProviderSkillDescriptor[]> {
  const allSkills = await collectSkillDescriptorsFromRoots(roots);
  const byName = new Map<string, ProviderSkillDescriptor>();
  for (const skill of allSkills) {
    const key = skillNameKey(skill.name);
    if (!byName.has(key)) {
      byName.set(key, skill);
    }
  }
  return [...byName.values()];
}

export interface SkillsCatalogDiscoveryInput {
  readonly cwd?: string | null;
  readonly homeDir: string;

  readonly gladeBaseDir: string;

  readonly provider?: ProviderKind | null;

  readonly includeDuplicateOrigins?: boolean;

  readonly forceReload?: boolean;
}

interface SkillsCatalogRootInput extends SkillsCatalogDiscoveryInput {
  readonly includeGladeRoot?: boolean;
}

const SKILLS_CATALOG_CACHE_TTL_MS = 15_000;
const SKILLS_CATALOG_CACHE_MAX_ENTRIES = 64;

interface SkillsCatalogCacheEntry {
  readonly at: number;
  readonly skills: ReadonlyArray<ProviderSkillDescriptor>;
}

const skillsCatalogCache = new Map<string, SkillsCatalogCacheEntry>();
const skillsCatalogInflight = new Map<string, Promise<ReadonlyArray<ProviderSkillDescriptor>>>();
const ensuredGladeSkillsDirs = new Set<string>();

export function gladeSkillsDir(gladeBaseDir: string): string {
  return nodePath.join(gladeBaseDir, "skills");
}

// The folder every agent reads: Codex, OpenCode, Cursor and Grok natively, Claude through Glade.
export function sharedSkillsDir(homeDir: string): string {
  return nodePath.join(homeDir, SHARED_DIRECTORY, "skills");
}

// The home folders agents read their own skills from, which skills can be moved out of.
export function agentSkillsDirs(homeDir: string): string[] {
  return [...SKILL_ORIGINS, ...PRIVATE_ORIGINS]
    .filter((origin) => origin.scope !== GLADE_ORIGIN && origin.directory !== SHARED_DIRECTORY)
    .map((origin) => nodePath.join(homeDir, origin.directory, "skills"));
}

// The home folder an agent reads its own skills from.
export function providerSkillsDir(provider: ProviderKind, homeDir: string): string {
  const skills = serverProviderDescriptor(provider).skills;
  const origin = [...skills.origins, ...(skills.privateOrigins ?? [])][0];
  if (!origin) throw new Error(`${provider} has no skills folder.`);
  return nodePath.join(homeDir, origin.directory, "skills");
}

// Which agent each skill scope belongs to.
export function skillScopeProviders(): Record<string, ProviderKind> {
  return Object.fromEntries(
    BUILT_IN_PROVIDERS.flatMap((provider) =>
      [...provider.skills.origins, ...(provider.skills.privateOrigins ?? [])].map(
        (origin) => [origin.scope, provider.kind] as const,
      ),
    ),
  );
}

export function sharedSkillsBridgedProviders(): ProviderKind[] {
  return BUILT_IN_PROVIDERS.filter((provider) => provider.skills.bridgesSharedSkills).map(
    (provider) => provider.kind,
  );
}

export function forgetSkillsCatalog(): void {
  skillsCatalogCache.clear();
}

async function ensureGladeSkillsDir(gladeBaseDir: string): Promise<string> {
  const dir = gladeSkillsDir(gladeBaseDir);
  if (ensuredGladeSkillsDirs.has(dir)) {
    return dir;
  }
  try {
    await fs.mkdir(dir, { recursive: true });
    ensuredGladeSkillsDirs.add(dir);
  } catch {}
  return dir;
}

// Each origin scans `<home>/<directory>/skills` and `<directory>/skills` in every project ancestor.
interface SkillOrigin {
  readonly scope: string;
  readonly directory: string;
}

const GLADE_ORIGIN = "glade";
const SHARED_DIRECTORY = ".agents";
const SKILL_ORIGINS: ReadonlyArray<SkillOrigin> = [
  { scope: GLADE_ORIGIN, directory: ".glade" },
  ...BUILT_IN_PROVIDERS.flatMap((provider) => provider.skills.origins),
  { scope: "agents", directory: SHARED_DIRECTORY },
];
const PRIVATE_ORIGINS: ReadonlyArray<SkillOrigin> = BUILT_IN_PROVIDERS.flatMap(
  (provider) => provider.skills.privateOrigins ?? [],
);
const HOME_ORIGIN_ORDER = SKILL_ORIGINS.map((origin) => origin.scope);

const originDirectory = (origin: string): string | undefined =>
  SKILL_ORIGINS.find((candidate) => candidate.scope === origin)?.directory;

function homeRootsForOrigin(origin: string, input: SkillsCatalogDiscoveryInput): string[] {
  if (origin === GLADE_ORIGIN) return [gladeSkillsDir(input.gladeBaseDir)];
  const directory = originDirectory(origin);
  return directory ? [nodePath.join(input.homeDir, directory, "skills")] : [];
}

function projectRootNamesForOrigin(origin: string): readonly string[] {
  const directory = originDirectory(origin);
  return directory ? [directory] : [];
}

function preferredOriginsForProvider(
  provider: ProviderKind | null | undefined,
): ReadonlyArray<string> {
  return provider ? serverProviderDescriptor(provider).skills.preferredScopes : [];
}

function orderedOriginsForProvider(
  provider: ProviderKind | null | undefined,
  includeGladeRoot = true,
  includeRemainingOrigins = true,
): string[] {
  const preferred = preferredOriginsForProvider(provider);
  const ordered = [...preferred];
  if (includeGladeRoot && !ordered.includes(GLADE_ORIGIN)) {
    ordered.push(GLADE_ORIGIN);
  }
  if (!includeRemainingOrigins) {
    return ordered.filter((origin) => includeGladeRoot || origin !== GLADE_ORIGIN);
  }
  for (const origin of HOME_ORIGIN_ORDER) {
    if (!includeGladeRoot && origin === GLADE_ORIGIN) {
      continue;
    }
    if (!ordered.includes(origin)) {
      ordered.push(origin);
    }
  }
  return ordered;
}

function rootsForOrderedOrigins(
  input: SkillsCatalogRootInput,
  orderedOrigins: ReadonlyArray<string>,
): SkillRoot[] {
  const homeRoots = orderedOrigins.flatMap((origin) =>
    homeRootsForOrigin(origin, input).map((path) => ({ path, scope: origin })),
  );
  const homeRootPaths = new Set(homeRoots.map((root) => nodePath.resolve(root.path)));

  const projectRoots: SkillRoot[] = [];
  const cwd = input.cwd?.trim();
  if (cwd) {
    for (const ancestor of ancestorsFromDeepest(cwd)) {
      const seenRootNames = new Set<string>();
      for (const origin of orderedOrigins) {
        for (const rootName of projectRootNamesForOrigin(origin)) {
          if (seenRootNames.has(rootName)) {
            continue;
          }
          seenRootNames.add(rootName);
          const rootPath = nodePath.join(ancestor, rootName, "skills");
          // A cwd under the home dir reaches the home skill folders as "project ancestors"; skip them here so
          // each folder is scanned once and keeps its true origin scope. Precedence is unchanged because
          // project and home roots share the same origin ordering.
          if (homeRootPaths.has(nodePath.resolve(rootPath))) {
            continue;
          }
          projectRoots.push({ path: rootPath, scope: "project" });
        }
      }
    }
  }

  return [...projectRoots, ...homeRoots];
}

function skillsCatalogRoots(input: SkillsCatalogRootInput): SkillRoot[] {
  return rootsForOrderedOrigins(
    input,
    orderedOriginsForProvider(input.provider, input.includeGladeRoot !== false),
  );
}

export async function discoverSkillsCatalog(
  input: SkillsCatalogDiscoveryInput,
): Promise<ProviderSkillDescriptor[]> {
  const cacheKey = [
    input.cwd?.trim() ?? "",
    input.provider ?? "",
    input.homeDir,
    input.gladeBaseDir,
    input.includeDuplicateOrigins ? "all-origins" : "deduped",
  ].join("\u0000");

  if (!input.forceReload) {
    const entry = skillsCatalogCache.get(cacheKey);
    if (entry && Date.now() - entry.at <= SKILLS_CATALOG_CACHE_TTL_MS) {
      return [...entry.skills];
    }
  }

  const inflight = skillsCatalogInflight.get(cacheKey);
  if (inflight) {
    return [...(await inflight)];
  }

  const scan = (async () => {
    await ensureGladeSkillsDir(input.gladeBaseDir);
    const roots = [
      ...skillsCatalogRoots(input),
      ...(input.provider
        ? []
        : PRIVATE_ORIGINS.map((origin) => ({
            path: nodePath.join(input.homeDir, origin.directory, "skills"),
            scope: origin.scope,
          }))),
      ...(
        await Promise.all(
          BUILT_IN_PROVIDERS.flatMap(({ skills }) =>
            skills.pluginRoots
              ? [
                  skills.pluginRoots({
                    homeDir: input.homeDir,
                    ...(input.cwd ? { cwd: input.cwd } : {}),
                  }),
                ]
              : [],
          ),
        )
      ).flat(),
    ];
    const skills = input.includeDuplicateOrigins
      ? await collectSkillDescriptorsFromRoots(roots)
      : await collectSkillsFromRoots(roots);

    skillsCatalogCache.delete(cacheKey);
    skillsCatalogCache.set(cacheKey, { at: Date.now(), skills });
    while (skillsCatalogCache.size > SKILLS_CATALOG_CACHE_MAX_ENTRIES) {
      const oldestKey = skillsCatalogCache.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      skillsCatalogCache.delete(oldestKey);
    }
    return skills;
  })();

  skillsCatalogInflight.set(cacheKey, scan);
  try {
    return [...(await scan)];
  } finally {
    skillsCatalogInflight.delete(cacheKey);
  }
}

export function filterDisabledSkills(
  skills: ReadonlyArray<ProviderSkillDescriptor>,
  disabledNames: ReadonlyArray<string>,
): ProviderSkillDescriptor[] {
  if (disabledNames.length === 0) {
    return [...skills];
  }
  const disabled = new Set(disabledNames.map((name) => skillNameKey(name)));
  return skills.filter((skill) => !disabled.has(skillNameKey(skill.name)));
}
