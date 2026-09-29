import { access, realpath } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import * as path from "node:path";

export const SANDBOX_OPT_OUT_ENV = "GLADE_DEVICE_HELPER_NO_SANDBOX";

const SANDBOX_PROFILE_NAME = "device-helper.sb";

export interface HelperSandboxContext {
  readonly binaryPath: string;

  readonly helperSourceDir: string;

  readonly developerDir: string | null;
  readonly env?: NodeJS.ProcessEnv;
}

export interface HelperSandboxCommand {
  readonly command: string;
  readonly args: readonly string[];

  readonly profilePath: string | null;
}

function xcodeAppRoot(developerDir: string): string {
  const marker = `${path.sep}Contents${path.sep}Developer`;
  const index = developerDir.indexOf(marker);
  return index === -1 ? developerDir : developerDir.slice(0, index);
}

async function resolved(target: string): Promise<string> {
  return await realpath(target).catch(() => target);
}

function sandboxDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[SANDBOX_OPT_OUT_ENV]?.trim();
  return value !== undefined && value.length > 0 && value !== "0" && value !== "false";
}

export async function sandboxedHelperCommand(
  argv: readonly string[],
  context: HelperSandboxContext,
): Promise<HelperSandboxCommand> {
  const [command, ...args] = argv;
  if (command === undefined) throw new Error("sandboxedHelperCommand needs a command");
  const plain: HelperSandboxCommand = { command, args, profilePath: null };

  if (process.platform !== "darwin") return plain;
  if (sandboxDisabled(context.env ?? process.env)) return plain;

  const profilePath = path.join(context.helperSourceDir, SANDBOX_PROFILE_NAME);
  const readable = await access(profilePath, fsConstants.R_OK).then(
    () => true,
    () => false,
  );
  if (!readable) return plain;

  const home = homedir();
  const [helperBundle, userHome, coreSimHome, coreSimLogs, darwinTmp, xcodeApp] = await Promise.all(
    [
      resolved(path.dirname(context.binaryPath)),
      resolved(home),
      resolved(path.join(home, "Library", "Developer", "CoreSimulator")),
      resolved(path.join(home, "Library", "Logs", "CoreSimulator")),
      resolved(tmpdir()),

      resolved(xcodeAppRoot(context.developerDir ?? "/Applications/Xcode.app")),
    ],
  );

  return {
    command: "/usr/bin/sandbox-exec",
    args: [
      "-f",
      profilePath,
      "-D",
      `HELPER_BUNDLE=${helperBundle}`,
      "-D",
      `USER_HOME=${userHome}`,
      "-D",
      `CORESIM_HOME=${coreSimHome}`,
      "-D",
      `CORESIM_LOGS=${coreSimLogs}`,
      "-D",
      `DARWIN_TMP=${darwinTmp}`,
      "-D",
      `XCODE_APP=${xcodeApp}`,
      command,
      ...args,
    ],
    profilePath,
  };
}

export function describeSandboxSuspicion(profilePath: string | null): string {
  if (profilePath === null) return "";
  return (
    ` The helper runs under the Seatbelt profile at ${profilePath}, and a missing rule there` +
    ` stalls it instead of erroring. Set ${SANDBOX_OPT_OUT_ENV}=1 to run it unconfined and` +
    ` confirm whether the profile is the cause.`
  );
}
