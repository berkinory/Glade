import type { BrowserHostMethod, BrowserHostResult } from "@glade/contracts/browser/browserHost";
import {
  BROWSER_BATCH_TOOLS,
  BrowserBatchInput,
  BrowserClickInput,
  BrowserConsoleInput,
  BrowserDialogInput,
  BrowserEvaluateInput,
  BrowserFillInput,
  BrowserFindInput,
  BrowserGetTextInput,
  BrowserHoverInput,
  BrowserNavigateInput,
  BrowserNetworkInput,
  BrowserPressInput,
  BrowserScreenshotInput,
  BrowserScrollInput,
  BrowserSelectInput,
  BrowserSnapshotInput,
  BrowserTabsInput,
  BrowserTypeInput,
  BrowserUploadInput,
  type BrowserBatchTool,
} from "@glade/contracts/browser/browserTools";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { Effect, FileSystem, Path, Schema } from "effect";

import { BrowserHostError, type BrowserHostShape } from "../../browser/Services/BrowserHost.ts";
import { browserThreadWorkspace } from "../../browser/browserThreadWorkspace.ts";
import type { ProjectionSnapshotQueryShape } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { toolInputSchema, type McpToolCallResult } from "../protocol.ts";
import { untrustedPageContent } from "./untrustedContent.ts";
import {
  GatewayToolError,
  gatewayToolErrorResult,
  type ToolContext,
  type ToolEntry,
} from "../toolRuntime.ts";

interface BrowserToolSpec {
  readonly method: BrowserHostMethod;
  readonly input: Schema.Decoder<Readonly<Record<string, unknown>>>;
  readonly title: string;
  readonly readOnly: boolean;
  readonly description: string;
  // Input actions report what changed themselves; the others end with the tab's URL and title.
  readonly action?: true;
}

const SPECS: Record<BrowserBatchTool, BrowserToolSpec> = {
  browser_tabs: {
    method: "browser.tabs",
    input: BrowserTabsInput,
    title: "Manage browser tabs",
    readOnly: false,
    description:
      "List, open, close or select tabs in Glade's built-in browser. Tabs belong to this thread, and the user sees them and shares their logins. open (optional url) makes the new tab active; other browser_* tools act on the active tab unless tabId is given.",
  },
  browser_navigate: {
    method: "browser.navigate",
    input: BrowserNavigateInput,
    title: "Navigate the browser",
    readOnly: false,
    description:
      "Open url (scheme optional; local dev servers work) or go back, forward or reload with history. Opens a tab when the thread has none and waits up to 30 s for the load. Returns URL and title; use browser_snapshot to see the page.",
  },
  browser_snapshot: {
    method: "browser.snapshot",
    input: BrowserSnapshotInput,
    title: "Snapshot the page",
    readOnly: true,
    description:
      'Accessibility snapshot of what is on screen plus about one screen around it, iframes included: one line per element, `- role "name" [ref=eN] value=… states`; `+` instead of `-` marks elements that were not in your previous snapshot. Hidden, covered and off-screen elements are left out; a note says how many are above or below. Act on elements through these refs. filter "interactive" (default) lists controls, including elements that only look clickable; "all" adds text and structure. scope "page" lists the whole page; narrow large pages with depth or a ref subtree. Refs stay valid while their element stays in the document.',
  },
  browser_find: {
    method: "browser.find",
    input: BrowserFindInput,
    title: "Find elements",
    readOnly: true,
    description:
      "Search elements by role, name or value (case-insensitive text, or a regex with regex: true). Returns up to 20 refs with their context; cheaper than a full snapshot when you know what you need.",
  },
  browser_get_text: {
    method: "browser.getText",
    input: BrowserGetTextInput,
    title: "Read page text",
    readOnly: true,
    description:
      "Readable text of the page's main content with headings marked, capped at maxChars (default 12000). For reading, not for acting.",
  },
  browser_click: {
    method: "browser.click",
    input: BrowserClickInput,
    title: "Click an element",
    readOnly: false,
    description:
      "Click ref with real mouse events after scrolling it into view; count 2 double-clicks. Fails with covered when another element (a modal, a banner) would receive the click. Waits for a navigation it starts or for the page to settle, then reports what changed: URL or title, new elements, a dialog, a new tab, a download. Checkbox and radio clicks report the resulting state.",
    action: true,
  },
  browser_hover: {
    method: "browser.hover",
    input: BrowserHoverInput,
    title: "Hover an element",
    readOnly: false,
    description: "Move the mouse over ref, for menus and tooltips.",
    action: true,
  },
  browser_type: {
    method: "browser.type",
    input: BrowserTypeInput,
    title: "Type text",
    readOnly: false,
    description:
      "Type text. With ref, focus that field and replace its content (date and time inputs take their value directly, like 2026-10-07); without, type into the focused element. Reports when the field ends up with a different value. submit presses Enter afterwards.",
    action: true,
  },
  browser_fill: {
    method: "browser.fill",
    input: BrowserFillInput,
    title: "Fill form fields",
    readOnly: false,
    description:
      "Set several form fields in one call: text fields and textareas get their text, selects an option label or value, date and time inputs their value, checkboxes, radios and switches true or false. Reports one line per field and stops at the first field that fails.",
    action: true,
  },
  browser_press: {
    method: "browser.press",
    input: BrowserPressInput,
    title: "Press a key",
    readOnly: false,
    description:
      "Press a key or chord on the focused element, for example Enter, Escape, ArrowDown, Control+A or Meta+K; repeat presses it several times.",
    action: true,
  },
  browser_select: {
    method: "browser.select",
    input: BrowserSelectInput,
    title: "Select options",
    readOnly: false,
    description:
      "Choose options of a <select> ref by value or label (case and spacing do not matter). For custom dropdowns, click the options instead.",
    action: true,
  },
  browser_scroll: {
    method: "browser.scroll",
    input: BrowserScrollInput,
    title: "Scroll",
    readOnly: false,
    description:
      "Scroll the page by direction and amount in CSS px (default about one screen), or bring ref into view; with ref and direction, scroll inside that element.",
    action: true,
  },
  browser_screenshot: {
    method: "browser.screenshot",
    input: BrowserScreenshotInput,
    title: "Take a screenshot",
    readOnly: true,
    description:
      "JPEG of the viewport, a ref or a region in CSS px, at most 1280 px on the long edge. For seeing layout and visuals; act through refs, not coordinates. Works while the browser panel is hidden.",
  },
  browser_dialog: {
    method: "browser.dialog",
    input: BrowserDialogInput,
    title: "Answer page dialogs",
    readOnly: false,
    description:
      "Answer the page's open alert or confirm: accept true for OK, false for Cancel. While a dialog is open the page is paused and other page tools refuse. Dialogs the user's own clicks open are theirs to answer.",
  },
  browser_upload: {
    method: "browser.upload",
    input: BrowserUploadInput,
    title: "Upload files",
    readOnly: false,
    description:
      "Attach files to a file input. ref is the <input type=file> or the button that opens the file chooser; paths are files inside this thread's workspace, relative or absolute.",
    action: true,
  },
  browser_console: {
    method: "browser.console",
    input: BrowserConsoleInput,
    title: "Read the console",
    readOnly: true,
    description:
      "Console messages and page errors of the current document (500 kept), 20 per page with the newest on page 1; repeats are grouped. Filter by level or text; clear empties the buffer after reading.",
  },
  browser_network: {
    method: "browser.network",
    input: BrowserNetworkInput,
    title: "Read network requests",
    readOnly: true,
    description:
      "Recent requests (500 kept) as id, method, status, type and URL, 20 per page with the newest on page 1; failedOnly keeps errors and 4xx/5xx. Pass requestId to read that response body (text, first 20000 characters).",
  },
};

const annotations = (spec: { readonly title: string; readonly readOnly: boolean }) => ({
  title: spec.title,
  readOnlyHint: spec.readOnly,
  destructiveHint: !spec.readOnly,
  idempotentHint: spec.readOnly,
  openWorldHint: true,
});

function resultContent(
  spec: BrowserToolSpec,
  result: BrowserHostResult,
): McpToolCallResult["content"] {
  const lines: string[] = [];
  if ("image" in result) lines.push(`Screenshot ${result.image.width}x${result.image.height}.`);
  else {
    if (result.text) lines.push(result.text);
    if (result.content) lines.push(untrustedPageContent(result.page?.url, result.content));
  }
  if (result.page && !spec.action) {
    lines.push(
      `Tab: ${result.page.tabId}`,
      `URL: ${result.page.url}`,
      `Title: ${JSON.stringify(result.page.title)}`,
    );
  } else if (result.page) lines.push(`Tab: ${result.page.tabId}`);
  for (const notice of result.notices) lines.push(`Note: ${notice}`);
  const text = { type: "text" as const, text: lines.join("\n") };
  return "image" in result
    ? [text, { type: "image" as const, data: result.image.data, mimeType: result.image.mimeType }]
    : [text];
}

const failure = (error: BrowserHostError) =>
  gatewayToolErrorResult(new GatewayToolError(error.code, error.message));

export function makeBrowserTools(services: {
  readonly host: BrowserHostShape;
  readonly snapshots: ProjectionSnapshotQueryShape;
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
}): readonly ToolEntry[] {
  const { host, snapshots, fs, path } = services;

  // Uploads read local files into the page, so every path must resolve, after symlinks, to a
  // regular file inside the caller thread's workspace.
  const uploadPaths = (paths: readonly string[], workspaceDir: string | null) =>
    Effect.gen(function* () {
      const fail = (code: BrowserHostError["code"], message: string) =>
        new BrowserHostError({ code, message });
      if (!workspaceDir) {
        return yield* fail(
          "workspace_unavailable",
          "This thread has no workspace folder to upload from.",
        );
      }
      const root = yield* fs
        .realPath(workspaceDir)
        .pipe(
          Effect.mapError(() =>
            fail("workspace_unavailable", "The thread workspace folder is missing."),
          ),
        );
      return yield* Effect.forEach(paths, (entry) =>
        Effect.gen(function* () {
          const real = yield* fs
            .realPath(path.resolve(root, entry))
            .pipe(Effect.mapError(() => fail("invalid_input", `${entry} does not exist.`)));
          const relative = path.relative(root, real);
          if (
            relative === ".." ||
            relative.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relative)
          ) {
            return yield* fail(
              "path_outside_workspace",
              `${entry} is outside this thread's workspace.`,
            );
          }
          const info = yield* fs
            .stat(real)
            .pipe(Effect.mapError(() => fail("invalid_input", `${entry} cannot be read.`)));
          if (info.type !== "File") return yield* fail("invalid_input", `${entry} is not a file.`);
          return real;
        }),
      );
    });

  // The thread always comes from the authenticated gateway session, never from tool input, so a
  // caller can only reach its own thread's tabs.
  const invoke = (tool: BrowserBatchTool, args: unknown, context: ToolContext) =>
    Effect.gen(function* () {
      const spec = SPECS[tool];
      const input = yield* Schema.decodeUnknownEffect(spec.input)(args).pipe(
        Effect.mapError(
          (error) =>
            new BrowserHostError({
              code: "invalid_input",
              message: `Invalid ${tool} input: ${error.message}`,
            }),
        ),
      );
      const threadId = ThreadId.makeUnsafe(context.callerThreadId);
      const workspaceDir = yield* browserThreadWorkspace(snapshots, threadId);
      const paths =
        tool === "browser_upload"
          ? yield* uploadPaths(input.paths as readonly string[], workspaceDir)
          : undefined;
      return yield* host.call(spec.method, {
        ...input,
        ...(paths ? { paths } : {}),
        threadId,
        workspaceDir,
      });
    });

  const entries = Object.entries(SPECS).map(
    ([name, spec]): ToolEntry => ({
      requiredCapability: "thread:write",
      requiresActiveTurn: true,
      definition: {
        name,
        description: spec.description,
        inputSchema: toolInputSchema(spec.input),
        annotations: annotations(spec),
      },
      handler: (args, context) =>
        invoke(name as BrowserBatchTool, args, context).pipe(
          Effect.match({
            onFailure: failure,
            onSuccess: (result) => ({ content: resultContent(spec, result) }),
          }),
        ),
    }),
  );

  const batch: ToolEntry = {
    requiredCapability: "thread:write",
    requiresActiveTurn: true,
    definition: {
      name: "browser_batch",
      description:
        "Run up to 20 browser_* calls in order and stop at the first failure. Each step is {tool, args} with that tool's arguments. Use it for predictable sequences such as type, press Enter, snapshot.",
      // Hand-written because steps carry free-form args: the generated schema for an unknown
      // record admits only null values, and each step's args are decoded by its own tool anyway.
      inputSchema: {
        type: "object",
        properties: {
          steps: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: {
              type: "object",
              properties: {
                tool: { type: "string", enum: BROWSER_BATCH_TOOLS },
                args: { type: "object", description: "That tool's arguments." },
              },
              required: ["tool", "args"],
              additionalProperties: false,
            },
          },
        },
        required: ["steps"],
        additionalProperties: false,
      },
      annotations: annotations({ title: "Run browser steps", readOnly: false }),
    },
    handler: (args, context) =>
      Effect.gen(function* () {
        const { steps } = yield* Schema.decodeUnknownEffect(BrowserBatchInput)(args).pipe(
          Effect.mapError(
            (error) =>
              new BrowserHostError({
                code: "invalid_input",
                message: `Invalid browser_batch input: ${error.message}`,
              }),
          ),
        );
        const content: Array<McpToolCallResult["content"][number]> = [];
        for (const [index, step] of steps.entries()) {
          const outcome = yield* Effect.result(invoke(step.tool, step.args, context));
          const label = `[${index + 1}/${steps.length}] ${step.tool}`;
          if (outcome._tag === "Failure") {
            content.push({
              type: "text",
              text: `${label} failed (${outcome.failure.code}): ${outcome.failure.message}\nRemaining steps were skipped.`,
            });
            return { content, isError: true };
          }
          const [first, ...rest] = resultContent(SPECS[step.tool], outcome.success);
          content.push(
            { type: "text", text: `${label}\n${first!.type === "text" ? first!.text : ""}` },
            ...rest,
          );
        }
        return { content };
      }).pipe(Effect.catch((error) => Effect.succeed(failure(error)))),
  };

  // Hidden until the per-thread setting exists: listing a tool that always refuses would cost
  // every call prompt tokens for nothing. Callers that know the name get a typed refusal.
  const evaluate: ToolEntry = {
    requiredCapability: "thread:write",
    requiresActiveTurn: true,
    discoveryOnly: true,
    definition: {
      name: "browser_evaluate",
      description:
        "Evaluate JavaScript in the page. Off unless the user enables it for this thread.",
      inputSchema: toolInputSchema(BrowserEvaluateInput),
      annotations: annotations({ title: "Evaluate JavaScript", readOnly: false }),
    },
    handler: () =>
      Effect.succeed(
        failure(
          new BrowserHostError({
            code: "evaluate_disabled",
            message:
              "browser_evaluate is turned off for this thread. Use browser_snapshot, browser_find or browser_get_text instead.",
          }),
        ),
      ),
  };

  return [...entries, batch, evaluate];
}
