import { Schema } from "effect";
import { z } from "zod";
import type { UserInputQuestion } from "@glade/contracts/provider/runtimePayloads";
import type { ProviderUserInputAnswers } from "@glade/contracts/provider/sessionPolicy";

const NullableString = Schema.optional(Schema.NullOr(Schema.String));
const Choices = Schema.Struct({ const: Schema.String, title: Schema.optional(Schema.String) });
const Field = Schema.Struct({
  type: Schema.Literals(["string", "number", "integer", "boolean", "array"]),
  title: NullableString,
  description: NullableString,
  enum: Schema.optional(Schema.Array(Schema.String)),
  oneOf: Schema.optional(Schema.Array(Choices)),
  items: Schema.optional(
    Schema.Struct({
      enum: Schema.optional(Schema.Array(Schema.String)),
      anyOf: Schema.optional(Schema.Array(Choices)),
    }),
  ),
});
const Form = Schema.Struct({
  type: Schema.Literal("object"),
  properties: Schema.Record(Schema.String, Schema.Unknown),
  required: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
});
export const McpElicitationRequest = Schema.Struct({
  message: Schema.String,
  mode: Schema.optional(Schema.Literals(["form", "url"])),
  url: Schema.optional(Schema.String),
  requestedSchema: Schema.optional(Schema.Unknown),
});
export const decodeMcpElicitationRequest = Schema.decodeUnknownSync(McpElicitationRequest);
export type McpElicitationInput = typeof McpElicitationRequest.Type;
export type McpElicitationResult = {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, string | number | boolean | string[]>;
};
export interface McpElicitationForm {
  readonly questions: ReadonlyArray<UserInputQuestion>;
  readonly respond: (answers: ProviderUserInputAnswers) => McpElicitationResult;
}

export function prepareMcpElicitation(input: McpElicitationInput): McpElicitationForm {
  const action: UserInputQuestion = {
    id: "action",
    header: "MCP request",
    question: input.message || "Respond to the MCP server request.",
    options: ["Continue", "Decline", "Cancel"].map((label) => ({
      label,
      description:
        label === "Continue"
          ? "Provide the requested input"
          : "Return this decision to the MCP server",
    })),
    multiSelect: false,
    elicitation: {},
  };
  if (input.mode === "url") {
    const url = new URL(input.url ?? "");
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new Error("MCP elicitation requires an HTTP or HTTPS URL.");
    return {
      questions: [{ ...action, elicitation: { url: url.href } }],
      respond: (answers) => ({ action: responseAction(answers) }),
    };
  }
  const form = Schema.decodeUnknownSync(Form)(input.requestedSchema);
  const fields = Object.entries(form.properties).map(([name, value]) => ({
    name,
    field: Schema.decodeUnknownSync(Field)(value),
  }));
  // This is a native JSON Schema boundary; Zod validates constraints beyond the presentation fields.
  const validation = z.fromJSONSchema(
    input.requestedSchema as Parameters<typeof z.fromJSONSchema>[0],
  );
  const required = new Set(form.required ?? []);
  const questions: UserInputQuestion[] = fields.map(({ name, field }) => {
    const choices = field.oneOf ?? field.items?.anyOf;
    const values =
      field.enum ?? field.items?.enum ?? (field.type === "boolean" ? ["true", "false"] : []);
    return {
      id: `field:${name}`,
      header: field.title || name,
      question: field.description || field.title || name,
      options: choices
        ? choices.map((choice) => ({ label: choice.const, description: choice.title ?? "" }))
        : values.map((label) => ({ label, description: "" })),
      multiSelect: field.type === "array",
      required: required.has(name),
    };
  });
  return {
    questions: [action, ...questions],
    respond: (answers) => {
      const decision = responseAction(answers);
      if (decision !== "accept") return { action: decision };
      const content: McpElicitationResult["content"] = {};
      for (const { name, field } of fields) {
        const answer = answers[`field:${name}`];
        if (answer === undefined || answer === null || answer === "") {
          if (required.has(name)) throw new Error(`Provide the required MCP field: ${name}`);
          continue;
        }
        if (field.type === "array") {
          content[name] = Array.isArray(answer) ? [...answer] : [answer];
        } else {
          if (typeof answer !== "string")
            throw new Error(`Provide one value for MCP field: ${name}`);
          content[name] =
            field.type === "boolean"
              ? parseBoolean(answer)
              : field.type === "number" || field.type === "integer"
                ? Number(answer)
                : answer;
        }
      }
      validation.parse(content);
      return { action: "accept", content };
    },
  };
}
function responseAction(answers: ProviderUserInputAnswers): McpElicitationResult["action"] {
  if (answers.action === "Decline") return "decline";
  if (answers.action === "Cancel" || Object.keys(answers).length === 0) return "cancel";
  if (answers.action !== "Continue") throw new Error("Choose how to respond to the MCP request.");
  return "accept";
}
function parseBoolean(answer: string): boolean {
  if (answer === "true") return true;
  if (answer === "false") return false;
  throw new Error("MCP boolean fields require true or false.");
}
