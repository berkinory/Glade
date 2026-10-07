import { Effect, Option, Schema } from "effect";
import * as FS from "node:fs/promises";
import * as Path from "node:path";

import { CuaClipboard } from "../../computer/cuaResults.ts";
import type { ToolEntry } from "../toolRuntime.ts";
import { untrustedContent } from "../untrustedContent.ts";
import {
  callCua,
  callerThread,
  computerTool,
  refuse,
  type ComputerToolServices,
} from "./computerCalls.ts";

const CONSENT_WAIT_MS = 45_000;
const MAX_READ_CHARS = 20_000;

const ClipboardWriteInput = Schema.Struct({
  text: Schema.optionalKey(Schema.String),
  image_path: Schema.optionalKey(
    Schema.String.annotate({ description: "Absolute path of an image to copy as an image." }),
  ),
  file_path: Schema.optionalKey(
    Schema.String.annotate({ description: "Absolute path of a file to copy as a file." }),
  ),
});

type CuaResult = { readonly structuredContent?: Record<string, unknown> | undefined };

const typesLine = (result: CuaResult) =>
  Schema.decodeUnknownOption(CuaClipboard)(result.structuredContent).pipe(
    Option.map((value) => `Clipboard types: ${value.types.join(", ") || "none"}.`),
    Option.getOrElse(() => ""),
  );

const textOf = (result: CuaResult) =>
  Schema.decodeUnknownOption(CuaClipboard)(result.structuredContent).pipe(
    Option.flatMap((value) => Option.fromNullishOr(value.text)),
    Option.getOrNull,
  );

const readResult = (result: CuaResult) => {
  const text = textOf(result);
  const lines =
    text === null
      ? ["The clipboard holds no plain text."]
      : [
          text.length > MAX_READ_CHARS
            ? `Clipboard text (${text.length} characters, the first ${MAX_READ_CHARS} shown):`
            : `Clipboard text (${text.length} characters):`,
          untrustedContent("APP_CONTENT", "source=clipboard", text.slice(0, MAX_READ_CHARS)),
        ];
  return {
    content: [
      { type: "text" as const, text: [...lines, typesLine(result)].filter(Boolean).join("\n") },
    ],
  };
};

// The clipboard has no app or window, so writing it is a thread-level capability that Computer
// Use being on allows; pasting it into an app is input that meets that app's grant. Reading it can
// expose anything the user copied, so it needs the thread's clipboard consent unless the clipboard
// still holds the agent's own text. Neither tool ever echoes or logs clipboard text, and read text
// reaches the model only inside APP_CONTENT.
export function makeClipboardTools(services: ComputerToolServices): ToolEntry[] {
  const write = computerTool(services, {
    name: "computer_clipboard_write",
    title: "Copy to the clipboard",
    description:
      "Replace the system clipboard with text, an image (image_path) or a file (file_path); exactly one. Paste with computer_menu Edit > Paste, which works in the background, or computer_key cmd+v on the target element_index.",
    input: ClipboardWriteInput,
    readOnly: false,
    run: (input, context) =>
      Effect.gen(function* () {
        const given = (["text", "image_path", "file_path"] as const).filter(
          (key) => input[key] !== undefined,
        );
        if (given.length !== 1) {
          return yield* refuse(
            "invalid_input",
            "Pass exactly one of text, image_path or file_path.",
          );
        }
        const path = input.image_path ?? input.file_path;
        if (path !== undefined) {
          if (!Path.isAbsolute(path)) {
            return yield* refuse(
              "invalid_input",
              `${JSON.stringify(path)} is not an absolute path.`,
            );
          }
          const exists = yield* Effect.tryPromise(() => FS.stat(path)).pipe(
            Effect.map((stat) => stat.isFile()),
            Effect.catch(() => Effect.succeed(false)),
          );
          if (!exists) return yield* refuse("target_not_found", `${path} is not a file.`);
        }
        const result = yield* callCua(services, context, "clipboard_write", {
          [given[0]!]: input.text ?? path,
        });
        services.access.clipboard.recordWrite(callerThread(context), input.text ?? null);
        const what =
          input.text !== undefined
            ? `text (${input.text.length} characters)`
            : input.image_path !== undefined
              ? `the image ${Path.basename(input.image_path)}`
              : `the file ${Path.basename(input.file_path!)}`;
        return {
          content: [
            { type: "text", text: [`Clipboard now holds ${what}.`, typesLine(result)].join("\n") },
          ],
        };
      }),
  });

  const read = computerTool(services, {
    name: "computer_clipboard_read",
    title: "Read the clipboard",
    description:
      "Plain text on the system clipboard and its types, e.g. to check a copy or paste. Text you wrote with computer_clipboard_write is read directly; anything else asks the user once per chat, and if the answer is pending, call again to keep waiting.",
    input: Schema.Struct({}),
    readOnly: true,
    run: (_input, context) =>
      Effect.gen(function* () {
        const threadId = callerThread(context);
        const current = yield* callCua(services, context, "clipboard_read", { include_text: true });
        if (services.access.clipboard.mayRead(threadId, textOf(current))) {
          return readResult(current);
        }
        const consent = yield* services.access.clipboard.request({
          threadId,
          turnId: context.callerTurnId,
          waitMs: CONSENT_WAIT_MS,
        });
        if (consent === "denied") {
          return yield* refuse(
            "access_denied",
            "The user does not allow reading the clipboard in this chat. Do not ask again unless the user says so.",
          );
        }
        if (consent === "pending") {
          return {
            content: [
              {
                type: "text",
                text: "Waiting for the user to allow clipboard reading. Call computer_clipboard_read again to keep waiting.",
              },
            ],
          };
        }
        // The card may have waited a while; return what the clipboard holds now.
        return readResult(
          yield* callCua(services, context, "clipboard_read", { include_text: true }),
        );
      }),
  });

  return [write, read];
}
