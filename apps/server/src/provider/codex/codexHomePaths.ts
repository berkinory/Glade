import { homedir } from "node:os";
import path from "node:path";

const GLADE_CODEX_HOME_OVERLAY_DIR = "codex-home-overlay";

export interface CodexHomePathsInput {
  readonly env?: NodeJS.ProcessEnv;
  readonly homePath?: string;
}

export function resolveBaseCodexHomePath(
  env: NodeJS.ProcessEnv,
  explicitHomePath?: string,
): string {
  return explicitHomePath?.trim() || env.CODEX_HOME?.trim() || path.join(homedir(), ".codex");
}

export function resolveGladeCodexHomeOverlayPath(
  env: NodeJS.ProcessEnv,
  sourceHomePath: string,
): string {
  const runtimeHome = env.GLADE_HOME?.trim();
  const overlayRoot = runtimeHome || path.join(path.dirname(sourceHomePath), ".glade", "runtime");
  return path.join(overlayRoot, GLADE_CODEX_HOME_OVERLAY_DIR);
}

export function resolveActiveCodexHomeWritePath(input: CodexHomePathsInput = {}): string {
  const env = input.env ?? process.env;
  const source = resolveBaseCodexHomePath(env, input.homePath);
  const overlay = resolveGladeCodexHomeOverlayPath(env, source);
  return path.resolve(source) === path.resolve(overlay) ? source : overlay;
}

export function resolveCodexHomeAllowlistCandidates(
  input: CodexHomePathsInput = {},
): readonly string[] {
  const env = input.env ?? process.env;
  const source = resolveBaseCodexHomePath(env, input.homePath);
  const overlay = resolveGladeCodexHomeOverlayPath(env, source);
  const sourceResolved = path.resolve(source);
  const overlayResolved = path.resolve(overlay);
  return sourceResolved === overlayResolved ? [source] : [source, overlay];
}
