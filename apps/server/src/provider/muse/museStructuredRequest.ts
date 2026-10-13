import type { ProviderStructuredRequestInput } from "../Services/ProviderAdapter.ts";
import { mintMspCommandId } from "./mspCommandId.ts";
import { callMsp, type MspConnection } from "./mspConnection.ts";
import {
  decodeMsp,
  MspItemDelta,
  MspItemEvent,
  MspTurnCompleted,
  MspTurnStartResult,
} from "./mspProtocol.ts";
import { museReasoningEffort } from "./museModelCatalog.ts";

function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Muse Code did not return a JSON object.");
  return JSON.parse(text.slice(start, end + 1));
}

// MSP has no structured output, so the schema rides in the prompt and the reply's JSON object is read
// from its text. The session refuses every tool call (see `withEphemeralMuseHost`).
export function runMuseStructuredRequest(
  connection: MspConnection,
  sessionId: string,
  input: ProviderStructuredRequestInput,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const replies = new Map<string, string>();
    let turnId: string | undefined;
    const detachSession = connection.attachSession(sessionId, (method, params) => {
      if (method === "item/delta") {
        const delta = decodeMsp(MspItemDelta, params);
        if (delta && (delta.field ?? "text") === "text") {
          replies.set(delta.itemId, (replies.get(delta.itemId) ?? "") + delta.delta);
        }
      } else if (method === "item/completed") {
        const item = decodeMsp(MspItemEvent, params)?.item;
        if (item?.kind === "agentMessage" && item.text !== undefined)
          replies.set(item.itemId, item.text);
      } else if (method === "turn/completed") {
        const completed = decodeMsp(MspTurnCompleted, params);
        if (!completed || completed.turnId !== turnId) return;
        detach();
        if (completed.terminal !== "completed") {
          reject(new Error(completed.error?.message ?? `The request turn ${completed.terminal}.`));
          return;
        }
        try {
          resolve(parseJsonObject([...replies.values()].join("\n")));
        } catch (cause) {
          reject(cause);
        }
      }
    });
    const stopExitWatch = connection.onExit((error) => {
      detach();
      reject(error);
    });
    function detach() {
      detachSession();
      stopExitWatch();
    }
    const commandId = mintMspCommandId();
    turnId = commandId;
    const effort = museReasoningEffort(input.effort);
    callMsp(
      connection,
      "turn/start",
      {
        sessionId,
        commandId,
        input: [
          {
            type: "text",
            text: `${input.instructions}\n\nReply with JSON matching this schema:\n${JSON.stringify(input.outputSchema)}`,
          },
          { type: "text", text: input.prompt },
        ],
        ...(effort ? { reasoningEffort: effort } : {}),
      },
      MspTurnStartResult,
    ).catch((cause: unknown) => {
      detach();
      reject(cause);
    });
  });
}
