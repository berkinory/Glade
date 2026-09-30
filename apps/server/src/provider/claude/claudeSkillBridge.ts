import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { SdkPluginConfig } from "@anthropic-ai/claude-agent-sdk";
import { discoverSkillsCatalog, gladeSkillsDir } from "../core/skillsCatalog.ts";

const PLUGIN_NAME = "glade-shared-skills";

export function isClaudeSkillAllowed(name: string, disabledNames: ReadonlyArray<string>): boolean {
  const normalized = name.trim().toLowerCase();
  const unqualified = normalized.startsWith(`${PLUGIN_NAME}:`)
    ? normalized.slice(PLUGIN_NAME.length + 1)
    : normalized;
  return !disabledNames.some((disabled) => {
    const key = disabled.trim().toLowerCase();
    return key === normalized || key === unqualified;
  });
}

export interface ClaudeSkillBridge {
  readonly plugin: SdkPluginConfig | undefined;
  readonly enabledSkills: ReadonlyArray<string>;
  readonly cleanup: () => Promise<void>;
}

export function isSharedClaudeSkill(skillPath: string, gladeBaseDir: string): boolean {
  const relativeToGladeRoot = path.relative(gladeSkillsDir(gladeBaseDir), skillPath);
  if (
    relativeToGladeRoot &&
    !relativeToGladeRoot.startsWith(`..${path.sep}`) &&
    relativeToGladeRoot !== ".." &&
    !path.isAbsolute(relativeToGladeRoot)
  ) {
    return true;
  }
  const segments = path.normalize(skillPath).split(path.sep);
  return segments.some(
    (segment) => segment === ".glade" || segment === ".codex" || segment === ".agents",
  );
}

export async function createClaudeSkillBridge(input: {
  readonly cwd: string;
  readonly homeDir: string;
  readonly baseDir: string;
  readonly stateDir: string;
  readonly disabledSkillNames?: ReadonlyArray<string>;
}): Promise<ClaudeSkillBridge> {
  const catalog = await discoverSkillsCatalog({
    cwd: input.cwd,
    homeDir: input.homeDir,
    gladeBaseDir: input.baseDir,
    provider: "claudeAgent",
    includeDuplicateOrigins: true,
    forceReload: true,
  });
  const nativeNames = catalog
    .filter(
      (skill) =>
        skill.enabled &&
        !isSharedClaudeSkill(skill.path, input.baseDir) &&
        isClaudeSkillAllowed(skill.name, input.disabledSkillNames ?? []),
    )
    .map((skill) => skill.name);
  const shared = catalog.filter(
    (skill) =>
      skill.enabled &&
      isSharedClaudeSkill(skill.path, input.baseDir) &&
      isClaudeSkillAllowed(`${PLUGIN_NAME}:${skill.name}`, input.disabledSkillNames ?? []) &&
      path.basename(skill.path).toLowerCase() === "skill.md",
  );
  if (shared.length === 0) {
    return { plugin: undefined, enabledSkills: [...new Set(nativeNames)], cleanup: async () => {} };
  }

  const pluginPath = await fs.mkdtemp(path.join(input.stateDir, "claude-skills-"));
  try {
    await fs.mkdir(path.join(pluginPath, ".claude-plugin"));
    await fs.mkdir(path.join(pluginPath, "skills"));
    await fs.writeFile(
      path.join(pluginPath, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: PLUGIN_NAME, version: "1.0.0" }),
      { mode: 0o600 },
    );
    const names = new Set<string>();
    const directories = new Set<string>();
    const bridgedNames: string[] = [];
    for (const skill of shared) {
      const directory = path.basename(path.dirname(skill.path));
      const key = skill.name.toLowerCase();
      if (names.has(key) || directories.has(directory.toLowerCase())) continue;
      names.add(key);
      directories.add(directory.toLowerCase());
      await fs.symlink(
        path.dirname(skill.path),
        path.join(pluginPath, "skills", directory),
        "junction",
      );
      bridgedNames.push(`${PLUGIN_NAME}:${skill.name}`);
    }
    return {
      plugin: { type: "local", path: pluginPath, skipMcpDiscovery: true },
      enabledSkills: [...new Set([...nativeNames, ...bridgedNames])],
      cleanup: () => fs.rm(pluginPath, { recursive: true, force: true }),
    };
  } catch (cause) {
    await fs.rm(pluginPath, { recursive: true, force: true });
    throw cause;
  }
}
