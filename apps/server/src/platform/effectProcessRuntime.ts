import { prepareProcess, type ProcessLaunchInput } from "@glade/shared/platformProcess";
import { ChildProcess } from "effect/unstable/process";

type ProcessPlanningOptions = Pick<ProcessLaunchInput, "platform">;

type EffectWindowsCommandOptions = ChildProcess.CommandOptions & {
  readonly windowsHide?: boolean;
  readonly windowsVerbatimArguments?: boolean;
};

export type EffectProcessRuntimeOptions = Omit<
  ChildProcess.CommandOptions,
  "shell" | "windowsVerbatimArguments"
> &
  ProcessPlanningOptions;

// Unlike the Node runtime there is deliberately no `requireExecutable`: the Effect spawner is
// injectable, so a missing executable surfaces as the spawner's own ENOENT error in the owning
// domain rather than a pre-spawn throw.
export function makeEffectProcessCommand(
  command: string,
  args: ReadonlyArray<string>,
  options: EffectProcessRuntimeOptions = {},
): ReturnType<typeof ChildProcess.make> {
  const { platform, ...commandOptions } = options;
  const effectivePlatform = platform ?? process.platform;

  if (effectivePlatform !== "win32") {
    return ChildProcess.make(command, [...args], {
      ...commandOptions,
      shell: false,
    });
  }

  const cwd = typeof commandOptions.cwd === "string" ? commandOptions.cwd : undefined;
  const env = commandOptions.env as NodeJS.ProcessEnv | undefined;
  const plan = prepareProcess(command, args, {
    platform: effectivePlatform,
    ...(cwd !== undefined ? { cwd } : {}),
    ...(env !== undefined ? { env } : {}),
  });

  const effectOptions: EffectWindowsCommandOptions = {
    ...commandOptions,
    shell: false,
    ...(plan.windowsHide ? { windowsHide: true } : {}),
    ...(plan.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
  };

  return ChildProcess.make(plan.command, plan.args, effectOptions);
}
