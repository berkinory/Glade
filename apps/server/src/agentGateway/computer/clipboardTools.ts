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

const ClipboardWriteInput = Schema.Struct({
  text: Schema.optionalKey(Schema.String),
  image_path: Schema.optionalKey(
    Schema.String.annotate({ description: "Absolute path of an image to copy as an image." }),
  ),
  file_path: Schema.optionalKey(
    Schema.String.annotate({ description: "Absolute path of a file to copy as a file." }),
  ),
});

const typesLine = (result: { readonly structuredContent?: Record<string, unknown> | undefined }) =>
  Schema.decodeUnknownOption(CuaClipboard)(result.structuredContent).pipe(
    Option.map((value) => `Clipboard types: ${value.types.join(", ") || "none"}.`),
    Option.getOrElse(() => ""),
  );

// The clipboard has no app or window, so writing it is a thread-level capability that Computer
// Use being on allows; pasting it into an app is input that meets that app's grant. Reading it can
// expose anything the user copied, so it needs the thread's clipboard consent. Neither tool ever
// echoes or logs what it wrote, and read text reaches the model only inside APP_CONTENT.
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
      "Plain text on the system clipboard and its types, e.g. to check a copy or paste. Outside Full access the user is asked once per chat; if the answer is pending, call again to keep waiting.",
    input: Schema.Struct({}),
    readOnly: true,
    run: (_input, context) =>
      Effect.gen(function* () {
        const consent = yield* services.access.clipboardRead({
          threadId: callerThread(context),
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
        const result = yield* callCua(services, context, "clipboard_read", { include_text: true });
        const text = Schema.decodeUnknownOption(CuaClipboard)(result.structuredContent).pipe(
          Option.flatMap((value) => Option.fromNullishOr(value.text)),
          Option.getOrNull,
        );
        const lines = [
          text === null
            ? "The clipboard holds no plain text."
            : `Clipboard text (${text.length} characters):`,
          ...(text === null ? [] : [untrustedContent("APP_CONTENT", "source=clipboard", text)]),
          typesLine(result),
        ];
        return { content: [{ type: "text", text: lines.filter(Boolean).join("\n") }] };
      }),
  });

  return [write, read];
}
