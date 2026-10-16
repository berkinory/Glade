import { WsRpcError } from "@glade/contracts/transport/ws/rpcErrors";
import {
  SKILLS_DIRECTORY_WS_METHODS,
  type SkillInstallInput,
} from "@glade/contracts/transport/ws/skillsDirectoryRpc";
import { Effect } from "effect";

import { installSkill, previewSkill } from "./skillsDirectory.ts";
import { searchSkillsDirectory } from "./skillsShDirectory.ts";

const attempt = <A>(run: () => Promise<A>, fallback: string) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new WsRpcError({
        message: cause instanceof Error && cause.message ? cause.message : fallback,
        cause,
      }),
  });

export function makeSkillsDirectoryWsHandlers(input: { readonly homeDir: string }) {
  return {
    [SKILLS_DIRECTORY_WS_METHODS.search]: (payload: { readonly query: string }) =>
      attempt(
        async () => ({ skills: await searchSkillsDirectory(payload.query) }),
        "skills.sh could not be searched.",
      ),
    [SKILLS_DIRECTORY_WS_METHODS.preview]: (payload: { readonly reference: string }) =>
      attempt(() => previewSkill(payload.reference), "Glade could not read that skill."),
    [SKILLS_DIRECTORY_WS_METHODS.install]: (payload: SkillInstallInput) =>
      attempt(
        async () => ({
          installedPaths: await installSkill({ ...payload, homeDir: input.homeDir }),
        }),
        "Glade could not install that skill.",
      ),
  };
}
