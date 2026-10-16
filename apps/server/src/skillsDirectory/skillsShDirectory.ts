import type {
  SkillAudit,
  SkillsDirectoryEntry,
} from "@glade/contracts/transport/ws/skillsDirectoryRpc";
import { isRecord } from "@glade/shared/transport/payloadValues";

import { decodeOutboundJson, outboundHttp } from "../platform/outboundHttp/outboundHttp.ts";
import { isRepositoryName } from "./githubSkills.ts";

const SKILLS_SH = "https://skills.sh";

const POLICY = {
  service: "skills-directory",
  allowedOrigins: [SKILLS_SH],
  timeoutMs: 10_000,
  maxRequestBytes: 0,
  maxResponseBytes: 1024 * 1024,
  maxRedirects: 0,
  maxConcurrent: 4,
  maxQueued: 8,
  requirePublicAddress: true,
  allowFakeIpDnsAddresses: true,
} as const;

async function getJson(path: string): Promise<{ status: number; json: unknown }> {
  const response = await outboundHttp.request({
    policy: POLICY,
    url: `${SKILLS_SH}${path}`,
    headers: { accept: "application/json" },
  });
  if (response.status === 404) return { status: 404, json: null };
  if (response.status !== 200) {
    throw new Error(`skills.sh answered with status ${response.status}.`);
  }
  return { status: 200, json: decodeOutboundJson(response, { maxDepth: 16, maxNodes: 50_000 }) };
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

// The search the skills CLI uses; skills.sh's versioned API needs a Vercel deployment's token.
export async function searchSkillsDirectory(query: string): Promise<SkillsDirectoryEntry[]> {
  const params = new URLSearchParams({ q: query.trim().slice(0, 100), limit: "20" });
  const { json } = await getJson(`/api/search?${params.toString()}`);
  const skills = isRecord(json) && Array.isArray(json.skills) ? json.skills : [];
  return skills.flatMap((skill): SkillsDirectoryEntry[] => {
    if (!isRecord(skill)) return [];
    const repository = text(skill.source);
    const skillId = text(skill.skillId);
    if (!isRepositoryName(repository) || !skillId) return [];
    return [
      {
        repository,
        skillId,
        name: text(skill.name) || skillId,
        installs: typeof skill.installs === "number" ? skill.installs : 0,
      },
    ];
  });
}

// Null when skills.sh could not be asked.
export async function skillAudits(
  repository: string,
  skillId: string,
): Promise<SkillAudit[] | null> {
  try {
    const { json } = await getJson(
      `/api/v1/skills/audit/${repository}/${encodeURIComponent(skillId)}`,
    );
    const audits = isRecord(json) && Array.isArray(json.audits) ? json.audits : [];
    return audits.flatMap((audit): SkillAudit[] =>
      isRecord(audit) && text(audit.provider) && text(audit.status)
        ? [
            {
              provider: text(audit.provider),
              status: text(audit.status),
              summary: text(audit.summary).slice(0, 600),
            },
          ]
        : [],
    );
  } catch {
    return null;
  }
}
