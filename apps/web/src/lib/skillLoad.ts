import { basenameOfPath } from "~/file-icons";
import { commandReadFilePaths } from "./toolCallLabel.commands";
import type { GladeMcpToolStatus } from "./gatewayToolCall";

const SKILL_FILE_NAME = "SKILL.md";

function skillNameFromPath(path: string | null | undefined): string | null {
  if (!path || basenameOfPath(path) !== SKILL_FILE_NAME) return null;
  const folder = basenameOfPath(path.slice(0, -SKILL_FILE_NAME.length - 1));
  return folder || null;
}

// Claude loads a skill through its `Skill` tool; other agents read the skill's SKILL.md with a read
// tool or a shell command, so the folder holding that file names the skill.
export function loadedSkillName(input: {
  readonly toolName: string | null | undefined;
  readonly toolInput: Readonly<Record<string, unknown>> | undefined;
  readonly isRead: boolean;
  readonly readPath: string | null | undefined;
  readonly command: string | null | undefined;
}): string | null {
  const skill = input.toolInput?.skill;
  if (input.toolName === "Skill" && typeof skill === "string" && skill.trim()) {
    return skill.trim();
  }
  if (!input.isRead) return null;
  if (input.readPath) return skillNameFromPath(input.readPath);
  if (!input.command) return null;
  const files = commandReadFilePaths(input.command);
  return files.length === 1 ? skillNameFromPath(files[0]) : null;
}

export function skillLoadTitle(status: GladeMcpToolStatus): string {
  switch (status) {
    case "running":
      return "Loading skill";
    case "failed":
      return "Couldn't load skill";
    case "cancelled":
      return "Stopped loading skill";
    case "completed":
      return "Loaded skill";
  }
}
