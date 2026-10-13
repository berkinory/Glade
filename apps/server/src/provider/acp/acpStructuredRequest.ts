import type { NewSessionResponse } from "@agentclientprotocol/sdk";

import type { ProviderStructuredRequestInput } from "../Services/ProviderAdapter.ts";
import type { AcpConnection } from "./acpConnection.ts";
import { acpConfigIdFor, acpModelOption, acpOffersValue } from "./acpModelCatalog.ts";

function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("The agent did not return a JSON object.");
  return JSON.parse(text.slice(start, end + 1));
}

// ACP has no structured output and no tool-free prompt, so the schema rides in the instructions,
// every permission request is rejected, and the reply's JSON object is read from its text.
export async function runAcpStructuredRequest(
  connection: AcpConnection,
  session: NewSessionResponse,
  input: ProviderStructuredRequestInput,
  switchModel: boolean,
): Promise<unknown> {
  let text = "";
  const detach = connection.attachSession(session.sessionId, {
    onUpdate: ({ update }) => {
      if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
        text += update.content.text;
      }
    },
    onPermission: async ({ options }) => {
      const reject = options.find((option) => option.kind === "reject_once");
      return reject ? { outcome: "selected", optionId: reject.optionId } : { outcome: "cancelled" };
    },
  });
  try {
    let options = session.configOptions ?? [];
    const set = async (configId: string | undefined, value: string | undefined) => {
      if (!configId || !value || !acpOffersValue(options, configId, value)) return;
      options = (
        await connection.agent.setSessionConfigOption({
          sessionId: session.sessionId,
          configId,
          value,
        })
      ).configOptions;
    };
    if (switchModel) await set(acpModelOption(options)?.id, input.model);
    await set(acpConfigIdFor(options, "effort"), input.effort);
    await connection.agent.prompt({
      sessionId: session.sessionId,
      prompt: [
        {
          type: "text",
          text: `${input.instructions}\n\nReply with JSON matching this schema:\n${JSON.stringify(input.outputSchema)}`,
        },
        { type: "text", text: input.prompt },
      ],
    });
    return parseJsonObject(text);
  } finally {
    detach();
  }
}
