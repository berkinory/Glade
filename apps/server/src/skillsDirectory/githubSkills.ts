import * as nodePath from "node:path/posix";

import { isRecord } from "@glade/shared/transport/payloadValues";

import { decodeOutboundJson, outboundHttp } from "../platform/outboundHttp/outboundHttp.ts";
import { parseSkillFrontmatter } from "../provider/core/skillFrontmatter.ts";

const GITHUB_API = "https://api.github.com";
const GITHUB_RAW = "https://raw.githubusercontent.com";

const policy = (origin: string, maxResponseBytes: number) => ({
  service: "skills-github",
  allowedOrigins: [origin],
  timeoutMs: 20_000,
  maxRequestBytes: 0,
  maxResponseBytes,
  maxRedirects: 0,
  maxConcurrent: 4,
  maxQueued: 64,
  requirePublicAddress: true,
  allowFakeIpDnsAddresses: true,
});

// A skill folder larger than these is refused rather than written to the user's disk.
const MAX_FILES = 200;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const SCRIPT_EXTENSIONS = new Set([
  ".sh",
  ".bash",
  ".zsh",
  ".py",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".rb",
  ".pl",
  ".php",
  ".ps1",
  ".bat",
  ".cmd",
  ".exe",
]);

export interface SkillReference {
  readonly repository: string;
  readonly skillId: string | null;
  readonly path: string | null;
  readonly ref: string | null;
}

export interface SkillFile {
  readonly path: string;
  readonly size: number;
  readonly executable: boolean;
}

export interface SkillFolder {
  readonly repository: string;
  readonly commit: string;
  readonly path: string;
  readonly files: ReadonlyArray<SkillFile>;
}

const NAME = /^[A-Za-z0-9_.-]+$/u;

export function isRepositoryName(value: string): boolean {
  const parts = value.split("/");
  return (
    parts.length === 2 && parts.every((part) => NAME.test(part) && part !== "." && part !== "..")
  );
}

// Accepts `owner/repo`, `owner/repo/skill`, a skills.sh skill URL, or a GitHub repository, folder
// or SKILL.md URL.
export function parseSkillReference(input: string): SkillReference | null {
  const value = input.trim();
  let url: URL | null = null;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }
  if (!url) {
    const parts = value.split("/").filter(Boolean);
    const repository = parts.slice(0, 2).join("/");
    if (!isRepositoryName(repository) || parts.length > 3) return null;
    return { repository, skillId: parts[2] ?? null, path: null, ref: null };
  }
  if (url.protocol !== "https:") return null;
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const repository = parts.slice(0, 2).join("/");
  if (!isRepositoryName(repository.replace(/\.git$/u, ""))) return null;
  if (url.host === "skills.sh") {
    return parts.length === 3
      ? { repository, skillId: parts[2] ?? null, path: null, ref: null }
      : null;
  }
  if (url.host !== "github.com") return null;
  const name = repository.replace(/\.git$/u, "");
  if (parts.length === 2) return { repository: name, skillId: null, path: null, ref: null };
  const [kind, ref, ...rest] = parts.slice(2);
  if ((kind !== "tree" && kind !== "blob") || !ref) return null;
  const folder = rest.at(-1)?.toLowerCase() === "skill.md" ? rest.slice(0, -1) : rest;
  return { repository: name, skillId: null, path: folder.join("/"), ref };
}

async function githubJson(path: string, maxBytes = 1024 * 1024): Promise<unknown> {
  const response = await outboundHttp.request({
    policy: policy(GITHUB_API, maxBytes),
    url: `${GITHUB_API}${path}`,
    headers: { accept: "application/vnd.github+json", "user-agent": "Glade" },
  });
  checkGithubStatus(response.status);
  return decodeOutboundJson(response, { maxDepth: 16, maxNodes: 2_000_000 });
}

export async function readRepositoryFile(
  repository: string,
  commit: string,
  path: string,
  maxBytes = MAX_FILE_BYTES,
): Promise<Uint8Array> {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const response = await outboundHttp.request({
    policy: policy(GITHUB_RAW, maxBytes),
    url: `${GITHUB_RAW}/${repository}/${commit}/${encoded}`,
    headers: { "user-agent": "Glade" },
  });
  if (response.status !== 200) {
    throw new Error(`GitHub could not send ${path} (status ${response.status}).`);
  }
  return response.body;
}

interface TreeEntry {
  readonly path: string;
  readonly mode: string;
  readonly type: string;
  readonly size: number;
}

async function readTree(repository: string, commit: string): Promise<TreeEntry[]> {
  const tree = await githubJson(
    `/repos/${repository}/git/trees/${commit}?recursive=1`,
    16 * 1024 * 1024,
  );
  if (!isRecord(tree) || !Array.isArray(tree.tree)) throw new Error("GitHub sent no file list.");
  if (tree.truncated === true) {
    throw new Error("This repository is too large to read. Paste the skill folder's GitHub URL.");
  }
  return tree.tree.flatMap((entry): TreeEntry[] =>
    isRecord(entry) && typeof entry.path === "string" && typeof entry.type === "string"
      ? [
          {
            path: entry.path,
            mode: typeof entry.mode === "string" ? entry.mode : "",
            type: entry.type,
            size: typeof entry.size === "number" ? entry.size : 0,
          },
        ]
      : [],
  );
}

function isSafeRelativePath(path: string): boolean {
  return path
    .split("/")
    .every(
      (segment) =>
        segment.length > 0 &&
        segment.length <= 255 &&
        segment !== "." &&
        segment !== ".." &&
        !/[\\\0:]/u.test(segment),
    );
}

// The files of one skill folder, refused when anything in it could escape the folder or is not
// a plain file.
function folderFiles(tree: ReadonlyArray<TreeEntry>, folder: string): SkillFile[] {
  const prefix = folder ? `${folder}/` : "";
  const files: SkillFile[] = [];
  let total = 0;
  for (const entry of tree) {
    if (!entry.path.startsWith(prefix) || entry.type === "tree") continue;
    const path = entry.path.slice(prefix.length);
    if (entry.type !== "blob" || (entry.mode !== "100644" && entry.mode !== "100755")) {
      throw new Error(`The skill contains ${path}, which is a link or submodule, not a file.`);
    }
    if (!isSafeRelativePath(path)) throw new Error(`The skill contains an unsafe path: ${path}.`);
    if (entry.size > MAX_FILE_BYTES) throw new Error(`${path} is larger than 5 MB.`);
    total += entry.size;
    files.push({ path, size: entry.size, executable: entry.mode === "100755" });
  }
  if (files.length > MAX_FILES) throw new Error(`The skill has more than ${MAX_FILES} files.`);
  if (total > MAX_TOTAL_BYTES) throw new Error("The skill is larger than 10 MB.");
  if (!files.some((file) => file.path === "SKILL.md")) {
    throw new Error("That folder has no SKILL.md.");
  }
  return files;
}

export function hasScripts(files: ReadonlyArray<SkillFile>): boolean {
  return files.some(
    (file) => file.executable || SCRIPT_EXTENSIONS.has(nodePath.extname(file.path).toLowerCase()),
  );
}

function checkGithubStatus(status: number): void {
  if (status === 404 || status === 422) {
    throw new Error("GitHub has no such repository, branch or folder.");
  }
  if (status === 403 || status === 429) {
    throw new Error("GitHub is rate limiting requests from this computer. Try again later.");
  }
  if (status !== 200) throw new Error(`GitHub answered with status ${status}.`);
}

// Asks for the bare SHA: the commit's JSON carries its whole diff.
async function resolveCommit(repository: string, ref: string | null): Promise<string> {
  const response = await outboundHttp.request({
    policy: policy(GITHUB_API, 4 * 1024),
    url: `${GITHUB_API}/repos/${repository}/commits/${encodeURIComponent(ref ?? "HEAD")}`,
    headers: { accept: "application/vnd.github.sha", "user-agent": "Glade" },
  });
  checkGithubStatus(response.status);
  const sha = new TextDecoder().decode(response.body).trim();
  if (!/^[0-9a-f]{40}$/u.test(sha)) throw new Error("GitHub sent no commit for that repository.");
  return sha;
}

async function findSkillFolder(
  reference: SkillReference,
  commit: string,
  tree: ReadonlyArray<TreeEntry>,
): Promise<string> {
  if (reference.path !== null) return reference.path;
  const folders = tree
    .filter(
      (entry) =>
        entry.type === "blob" && (entry.path === "SKILL.md" || entry.path.endsWith("/SKILL.md")),
    )
    .map((entry) => nodePath.dirname(entry.path).replace(/^\.$/u, ""));
  const { skillId } = reference;
  if (skillId === null) {
    if (folders.length === 1 && folders[0] !== undefined) return folders[0];
    throw new Error(
      folders.length === 0
        ? "This repository has no skills."
        : `This repository has ${folders.length} skills. Search for one, or paste its folder URL.`,
    );
  }
  const byFolder = folders.filter((folder) => nodePath.basename(folder) === skillId);
  if (byFolder.length === 1 && byFolder[0] !== undefined) return byFolder[0];
  // Folder names can differ from the skill's name, so its frontmatter decides.
  for (const folder of folders.slice(0, 40)) {
    const skillMd = await readRepositoryFile(
      reference.repository,
      commit,
      folder ? `${folder}/SKILL.md` : "SKILL.md",
      256 * 1024,
    );
    if (parseSkillFrontmatter(new TextDecoder().decode(skillMd)).name === skillId) return folder;
  }
  throw new Error(`${reference.repository} has no skill named ${skillId}.`);
}

export async function resolveSkillFolder(reference: SkillReference): Promise<SkillFolder> {
  const commit = await resolveCommit(reference.repository, reference.ref);
  const tree = await readTree(reference.repository, commit);
  const path = await findSkillFolder(reference, commit, tree);
  return { repository: reference.repository, commit, path, files: folderFiles(tree, path) };
}

// Install reads the folder again at the pinned commit instead of trusting a list from the client.
export async function readSkillFolder(
  repository: string,
  commit: string,
  path: string,
): Promise<SkillFolder> {
  if (!isRepositoryName(repository) || !/^[0-9a-f]{40}$/u.test(commit)) {
    throw new Error("That is not a GitHub repository and commit.");
  }
  if (path !== "" && !isSafeRelativePath(path)) throw new Error("That is not a skill folder.");
  const tree = await readTree(repository, commit);
  return { repository, commit, path, files: folderFiles(tree, path) };
}
