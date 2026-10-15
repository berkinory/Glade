import { randomUUID } from "node:crypto";
import { Effect, Option, Schema } from "effect";
import { CommandId, EventId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import type { OrchestrationThreadActivity } from "@glade/contracts/orchestration/threadEntities";
import {
  VisualComponentsInput,
  type VisualComponentsReply,
} from "@glade/contracts/orchestration/visualComponents";
import {
  VisualReplyInput,
  VisualReplyPreviewInput,
  VISUAL_REPLY_ACTIVITY_KIND,
  VISUAL_REPLY_STARTED_ACTIVITY_KIND,
  type VisualReply,
} from "@glade/contracts/orchestration/visualReply";
import { resolveThreadWorkspaceCwd } from "../checkpointing/Utils";
import { prepareVisualReply, VisualReplyError } from "../visualReplies/visualReplySource";
import type { VisualReplyPreviewShape } from "../visualReplies/Services/VisualReplyPreview";
import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery";
import type { OrchestrationEngineShape } from "../orchestration/Services/OrchestrationEngine";
import type { ManagedAttachmentRepositoryShape } from "../persistence/Services/ManagedAttachments";
import type { ServerConfigShape } from "../server/config";
import {
  persistReservedManagedAttachment,
  reserveManagedAttachmentUpload,
} from "../attachments/managedAttachmentStore";
import type { ManagedAttachmentPrincipal } from "../attachments/managedAttachmentPrincipal";
import { mcpToolResultError, mcpToolResultJson, toolInputSchema } from "./protocol";
import { errorText } from "./toolInput";
import type { ToolContext, ToolEntry } from "./toolRuntime";

const VISUAL_REPLY_LAYOUT_GUIDE =
  "The page is part of the reply: use fluid width and let content determine height. Keep html, body and the outermost container transparent, with no outer horizontal padding, framing card, border, shadow or repeated banner title. Add a background only when the content requires a distinct surface, such as an actual UI mockup or a meaningful inner panel; use themed surfaces and --glade-radius. This overrides general style preferences such as a fixed black page background. Give a box with its own background at least 16px of padding on every side so its content never touches the edge. Do not fill the page merely to decorate or separate it. Use clear visual hierarchy, readable spacing and restrained accents. Give charts explicit pixel heights; avoid 100vh and height:100% on html/body. Make initial HTML/SVG meaningful before scripts run, then enhance it with working interactions.";

const VISUAL_REPLY_THEME_GUIDE =
  "Live CSS variables: --glade-background (transparent reply canvas), --glade-foreground, --glade-muted, --glade-accent, --glade-border; --glade-surface/--glade-surface-foreground and --glade-secondary/--glade-secondary-foreground for intentional inner surfaces; --glade-input, --glade-ring, --glade-radius; --glade-chart-1 through --glade-chart-5; --glade-font-family, --glade-font-mono, --glade-font-size. Use these instead of hardcoded light/dark surface and text colors. Native controls follow the reader's color scheme. Theme changes preserve interactive state.";

const VISUAL_COMPONENTS_DESCRIPTION =
  "Publish a native visual reply inline in the current Glade conversation, drawn by Glade's own components in the reader's theme and font size. Prefer this over html_render whenever these blocks express the visual: headline stats, bar or line charts, sortable tables, checklists and follow-up choices, optionally grouped in tabs. Use html_render only for diagrams, mockups, custom layouts or interactions these blocks cannot express. No html_begin call is needed. Blocks carry plain text and numbers; markup is shown literally. " +
  "stats {items:[{label, value (text or number), detail?, trend?: up|down|flat}]}: 1-6 headline numbers. " +
  "chart {kind: bar|line, title?, unit?, labels, series:[{name, values}]}: one value per label in every series, up to 60 labels and 5 series; a line needs at least two labels. Put the unit in unit, not in labels. " +
  "table {title?, columns, rows}: one string or number per column in every row, up to 8 columns and 100 rows; readers can sort any column, and numeric columns align right. " +
  "checklist {title?, items:[{label, detail?, checked?}]}: readers can tick items while viewing; ticks are not saved or sent to you. " +
  "choices {prompt?, options:[{label, message?}]}: 1-6 follow-up options. After your turn ends, a reader's click sends message (default label) as their next message; choices are disabled once the conversation moves on. Put choices last and do not repeat them as text. " +
  "tabs {tabs:[{label, blocks}]}: 2-6 views of the same subject holding any blocks except tabs. " +
  "At most 12 blocks and 64 KiB of JSON. Order blocks as the reader should read them, answer first. The reader sees the visual, so the final reply should add only information the visual does not convey.";

const VISUAL_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

interface VisualReplyToolServices {
  readonly preview: VisualReplyPreviewShape;
  readonly snapshots: ProjectionSnapshotQueryShape;
  readonly engine: OrchestrationEngineShape;
  readonly attachments: ManagedAttachmentRepositoryShape;
  readonly config: ServerConfigShape;
}

export function makeVisualReplyTools(services: VisualReplyToolServices): readonly ToolEntry[] {
  const prepare = (source: VisualReplyInput | VisualReplyPreviewInput, context: ToolContext) =>
    Effect.gen(function* () {
      yield* context.assertCallerTurnActive();
      const thread = yield* services.snapshots.getThreadShellById(
        ThreadId.makeUnsafe(context.callerThreadId),
      );
      if (Option.isNone(thread))
        return yield* new VisualReplyError({ message: "Caller thread not found." });
      const project = yield* services.snapshots.getProjectShellById(thread.value.projectId);
      const workspaceRoot = resolveThreadWorkspaceCwd({
        thread: thread.value,
        projects: Option.isSome(project) ? [project.value] : [],
      });
      return yield* prepareVisualReply({ source, workspaceRoot: workspaceRoot ?? null });
    });
  const principalFor = (context: ToolContext): ManagedAttachmentPrincipal => ({
    ownerKind: "session",
    ownerId: `agent:${context.callerSessionKey}`,
  });
  const store = (input: {
    readonly bytes: Uint8Array;
    readonly type: "image" | "file";
    readonly name: string;
    readonly mimeType: string;
    readonly context: ToolContext;
  }) =>
    Effect.gen(function* () {
      const principal = principalFor(input.context);
      const reservation = yield* reserveManagedAttachmentUpload({
        type: input.type,
        purpose: input.type === "image" ? "visual-reply-preview" : "visual-reply",
        threadId: input.context.callerThreadId,
        name: input.name,
        mimeType: input.mimeType,
        reservedBytes: input.bytes.byteLength,
        now: new Date().toISOString(),
        principal,
        repository: services.attachments,
      });
      return yield* persistReservedManagedAttachment({
        reservation,
        bytes: input.bytes,
        attachmentsDir: services.config.attachmentsDir,
        now: new Date().toISOString(),
        principal,
        repository: services.attachments,
      });
    });
  const appendVisualActivity = (
    context: ToolContext,
    activity: Pick<OrchestrationThreadActivity, "kind" | "tone" | "summary" | "payload">,
    attachmentPrincipal?: ManagedAttachmentPrincipal,
  ) =>
    Effect.gen(function* () {
      yield* context.assertCallerTurnActive();
      if (!context.callerTurnId)
        return yield* new VisualReplyError({ message: "Visuals require an active turn." });
      const marker = `visual:${randomUUID()}`;
      const createdAt = new Date().toISOString();
      yield* services.engine.dispatch(
        {
          type: "thread.activity.append",
          commandId: CommandId.makeUnsafe(marker),
          threadId: ThreadId.makeUnsafe(context.callerThreadId),
          activity: {
            id: EventId.makeUnsafe(marker),
            ...activity,
            turnId: TurnId.makeUnsafe(context.callerTurnId),
            createdAt,
          },
          createdAt,
        },
        attachmentPrincipal ? { attachmentPrincipal } : undefined,
      );
    });
  const cancel = (id: string, context: ToolContext) =>
    services.attachments
      .cancelStaged({
        attachmentId: id,
        ...principalFor(context),
        reason: "visual-reply-not-published",
        requestedAt: new Date().toISOString(),
      })
      .pipe(Effect.ignore);

  return [
    {
      requiredCapability: "thread:write",
      requiresActiveTurn: true,
      definition: {
        name: "html_begin",
        description:
          "Begin creating an inline visual. Call this with a short title BEFORE composing HTML or writing its source file, so the reader sees creation progress during generation. Then create the HTML and publish with html_render. This does not publish a visual.",
        inputSchema: toolInputSchema(Schema.Struct({ title: VisualReplyInput.fields.title })),
        annotations: VISUAL_TOOL_ANNOTATIONS,
      },
      handler: (args, context) =>
        Effect.gen(function* () {
          const source = yield* Schema.decodeUnknownEffect(
            Schema.Struct({ title: VisualReplyInput.fields.title }),
          )(args);
          yield* appendVisualActivity(context, {
            kind: VISUAL_REPLY_STARTED_ACTIVITY_KIND,
            tone: "tool",
            summary: source.title,
            payload: {},
          });
          return mcpToolResultJson({ started: true, title: source.title });
        }).pipe(Effect.catch((error) => Effect.succeed(mcpToolResultError(errorText(error))))),
    },
    {
      requiredCapability: "thread:write",
      requiresActiveTurn: true,
      definition: {
        name: "html_preview",
        description:
          "Check a visual reply in a separate sandboxed browser and return its screenshot, content height and bounded console output. Provide exactly one of html or path (inside the caller workspace). Inline scripts, styles and SVG; local PNG/JPEG/GIF/WebP images are embedded. Public HTTP(S) resources are available; private/local network destinations, files outside the workspace and browser permissions are blocked. Prefer inline assets for reliable previews. The first preview downloads a pinned Chrome headless shell once; each preview closes its browser. Pass the returned previewAttachmentId to html_render with the same source to retain the screenshot. Preview alone does not publish a reply. Width defaults to 728px; use about 390px to check narrow layouts. appearance selects light or dark, defaulting to dark. The screenshot is cropped to content up to the requested height. " +
          VISUAL_REPLY_LAYOUT_GUIDE +
          " " +
          VISUAL_REPLY_THEME_GUIDE,
        inputSchema: toolInputSchema(VisualReplyPreviewInput),
        annotations: VISUAL_TOOL_ANNOTATIONS,
      },
      handler: (args, context) =>
        Effect.gen(function* () {
          const source = yield* Schema.decodeUnknownEffect(VisualReplyPreviewInput)(args);
          const prepared = yield* prepare(source, context);
          const result = yield* services.preview.capture({
            html: prepared.html,
            width: source.width ?? 728,
            height: source.height ?? 720,
            appearance: source.appearance ?? "dark",
          });
          yield* context.assertCallerTurnActive();
          const preview = yield* store({
            type: "image",
            bytes: result.png,
            name: `visual-preview-${prepared.hash}.png`,
            mimeType: "image/png",
            context,
          });
          const metadata = {
            previewAttachmentId: preview.id,
            sourceHash: prepared.hash,
            contentHeight: result.contentHeight,
            console: result.console,
          };
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(metadata) },
              {
                type: "image" as const,
                data: Buffer.from(result.png).toString("base64"),
                mimeType: "image/png",
              },
            ],
          };
        }).pipe(Effect.catch((error) => Effect.succeed(mcpToolResultError(errorText(error))))),
    },
    {
      requiredCapability: "thread:write",
      requiresActiveTurn: true,
      definition: {
        name: "html_render",
        description:
          "Call html_begin before composing the HTML. Prefer components_render when its blocks (stats, charts, tables, checklists, choices, tabs) express the visual. Publish a persistent HTML visual reply inline in the current Glade conversation before the final answer. Use it for charts, diagrams, galleries, interactive tables or mockups. Provide exactly one of html or a workspace path. Prefer self-contained HTML with inline styles, scripts and SVG; public HTTP(S) resources and links are supported, and local raster images are embedded. Scripts run in an opaque sandbox without Glade APIs, browser-session access or persistent storage. Keep edits in memory and provide working inputs and completion controls when interaction is requested. Pass height (80–2000px), normally the preview contentHeight. A smaller height deliberately scrolls the content. Height is measured at nine widths when the preview browser is installed, then follows live layout up to 2000px. html_preview is an optional screenshot/console check for complex visuals or debugging; publishing never downloads a browser. The reader sees the visual, so the final reply should add only information the visual does not convey. " +
          VISUAL_REPLY_LAYOUT_GUIDE +
          " " +
          VISUAL_REPLY_THEME_GUIDE,
        inputSchema: toolInputSchema(VisualReplyInput),
        annotations: VISUAL_TOOL_ANNOTATIONS,
      },
      handler: (args, context) =>
        Effect.gen(function* () {
          const source = yield* Schema.decodeUnknownEffect(VisualReplyInput)(args);
          const prepared = yield* prepare(source, context);
          const principal = principalFor(context);
          if (source.previewAttachmentId) {
            const preview = yield* services.attachments.findServerOwned({
              attachmentId: source.previewAttachmentId,
              ownerThreadId: context.callerThreadId,
              ...principal,
              now: new Date().toISOString(),
            });
            if (
              Option.isNone(preview) ||
              preview.value.mimeType !== "image/png" ||
              preview.value.originalName !== `visual-preview-${prepared.hash}.png`
            )
              return yield* new VisualReplyError({
                message:
                  "Preview is unavailable, belongs to another session, or was captured from different HTML. Preview the current source again.",
              });
          }
          const heights = yield* services.preview.measure(prepared.html);
          const attachment = yield* store({
            type: "file",
            bytes: Buffer.from(prepared.html),
            name: `${prepared.hash}.html`,
            mimeType: "text/html",
            context,
          });
          const reply: VisualReply = {
            version: 1,
            height: source.height,
            ...(heights ? { heights } : {}),
            threadId: ThreadId.makeUnsafe(context.callerThreadId),
            title: source.title,
            attachmentId: attachment.id,
            ...(source.previewAttachmentId
              ? { previewAttachmentId: source.previewAttachmentId }
              : {}),
          };
          yield* appendVisualActivity(
            context,
            {
              kind: VISUAL_REPLY_ACTIVITY_KIND,
              tone: "info",
              summary: source.title,
              payload: {
                version: reply.version,
                threadId: reply.threadId,
                title: reply.title,
                attachmentId: reply.attachmentId,
                height: source.height,
                ...(heights ? { heights: heights.map(([width, height]) => [width, height]) } : {}),
                ...(reply.previewAttachmentId
                  ? { previewAttachmentId: reply.previewAttachmentId }
                  : {}),
              },
            },
            principal,
          ).pipe(Effect.ensuring(cancel(attachment.id, context)));
          return mcpToolResultJson({ published: true, ...reply });
        }).pipe(Effect.catch((error) => Effect.succeed(mcpToolResultError(errorText(error))))),
    },
    {
      requiredCapability: "thread:write",
      requiresActiveTurn: true,
      definition: {
        name: "components_render",
        description: VISUAL_COMPONENTS_DESCRIPTION,
        inputSchema: toolInputSchema(VisualComponentsInput),
        annotations: VISUAL_TOOL_ANNOTATIONS,
      },
      handler: (args, context) =>
        Effect.gen(function* () {
          const input = yield* Schema.decodeUnknownEffect(VisualComponentsInput)(args);
          const reply: VisualComponentsReply = {
            version: 1,
            format: "components",
            threadId: ThreadId.makeUnsafe(context.callerThreadId),
            title: input.title,
            blocks: input.blocks,
          };
          yield* appendVisualActivity(context, {
            kind: VISUAL_REPLY_ACTIVITY_KIND,
            tone: "info",
            summary: input.title,
            payload: reply,
          });
          return mcpToolResultJson({ published: true, title: input.title });
        }).pipe(Effect.catch((error) => Effect.succeed(mcpToolResultError(errorText(error))))),
    },
  ];
}
