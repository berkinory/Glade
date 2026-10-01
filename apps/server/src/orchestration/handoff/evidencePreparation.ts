import { Effect, Schema } from "effect";
import { HandoffRecord } from "@glade/contracts/orchestration/threadEntities";
import { ProviderValidationError } from "../../provider/core/Errors";
import {
  estimateHandoffTokens,
  preparationPrompt,
  segmentHandoffEvidence,
  type HandoffEvidence,
} from "./contextPolicy";

export const prepareEvidenceRecord = Effect.fnUntraced(function* (input: {
  readonly evidence: ReadonlyArray<HandoffEvidence>;
  readonly goal: string;
  readonly preparationBudget: number;
  readonly generate: (prompt: string) => Effect.Effect<HandoffRecord, ProviderValidationError>;
}) {
  const { evidence, goal, preparationBudget, generate } = input;
  const segments = yield* Effect.try({
    try: () => segmentHandoffEvidence(evidence, preparationBudget, goal),
    catch: (cause) =>
      Schema.is(ProviderValidationError)(cause)
        ? cause
        : new ProviderValidationError({
            operation: "handoff.prepare",
            issue: "Invalid handoff evidence or context budget.",
            cause,
          }),
  });
  let records = yield* Effect.forEach(
    segments,
    (segment) => generate(preparationPrompt(goal, segment)),
    { concurrency: 1 },
  );
  const latestUser = evidence.findLast(
    (entry) => entry.messageId !== undefined && JSON.parse(entry.text).role === "user",
  );
  while (records.length > 1) {
    const merged: HandoffRecord[] = [];
    for (let index = 0; index < records.length; index += 2) {
      const pair = records.slice(index, index + 2);
      if (pair.length === 1) {
        merged.push(pair[0]!);
        continue;
      }
      const originals = pair
        .flatMap((record) => record.sourcePassages)
        .filter(
          (passage, position, all) =>
            all.findIndex(
              (entry) => entry.sourceRef === passage.sourceRef && entry.text === passage.text,
            ) === position,
        )
        .map((passage) => ({
          ref: passage.sourceRef,
          text: JSON.stringify({ text: passage.text, selectedOriginalPassage: true }),
        }));
      if (latestUser) originals.push(latestUser);
      const prompt = preparationPrompt(goal, originals, pair);
      if (estimateHandoffTokens(prompt) > preparationBudget)
        return yield* new ProviderValidationError({
          operation: "handoff.prepare",
          issue:
            "Consolidating the evidence requires more destination context. Choose a larger supported context and retry; completed preparation passes are retained.",
        });
      merged.push(yield* generate(prompt));
    }
    records = merged;
  }
  const record = records[0];
  if (!record)
    return yield* new ProviderValidationError({
      operation: "handoff.prepare",
      issue: "The frozen source has no available handoff evidence.",
    });
  return record;
});
