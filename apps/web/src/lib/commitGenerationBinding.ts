import type { NativeApi } from "@glade/contracts/ipc/ipc";

type CommitApi = Pick<NativeApi["git"], "generateCommitMessage" | "commitStaged">;

export function bindCommitGeneration(api: CommitApi): CommitApi {
  const suggestions = new Map<
    string,
    { message: string; snapshot: string; scope: "staged" | "workingTree"; expires: number }
  >();
  const current = (cwd: string) => {
    const suggestion = suggestions.get(cwd);
    return suggestion;
  };
  return {
    generateCommitMessage: async (input) => {
      const result = await api.generateCommitMessage(input);
      if (result.snapshot && result.scope) {
        if (suggestions.size >= 16) suggestions.delete(suggestions.keys().next().value!);
        suggestions.set(input.cwd, {
          message: result.message.trim(),
          snapshot: result.snapshot,
          scope: result.scope,
          expires: Date.now() + 10 * 60_000,
        });
      }
      return result;
    },
    commitStaged: async (input) => {
      const suggestion = current(input.cwd);
      if (suggestion?.message === input.message.trim() && suggestion.expires <= Date.now())
        throw new Error(
          "The generated suggestion expired. Regenerate or edit the message before committing.",
        );
      await api.commitStaged({
        ...input,
        ...(suggestion?.message === input.message.trim()
          ? { expectedSnapshot: suggestion.snapshot, generationScope: suggestion.scope }
          : {}),
      });
      suggestions.delete(input.cwd);
    },
  };
}
