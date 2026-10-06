import { randomUUID } from "node:crypto";
import { Effect, Option, Schema } from "effect";
import { CommandId, EventId, ThreadId, TurnId } from "@glade/contracts/core/baseSchemas";
import {
  VisualReplyInput,
  VisualReplyPreviewInput,
  VISUAL_REPLY_ACTIVITY_KIND,
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

interface VisualReplyToolServices {
  readonly preview: VisualReplyPreviewShape;
  readonly snapshots: ProjectionSnapshotQueryShape;
  readonly engine: OrchestrationEngineShape;
  readonly attachments: ManagedAttachmentRepositoryShape;
  readonly config: ServerConfigShape;
}

export function makeVisualReplyTools(services: VisualReplyToolServices): readonly ToolEntry[] {
  const prepare = (source: VisualReplyInput, context: ToolContext) =>
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
        name: "html_preview",
        description:
          "Check a visual reply in a separate sandboxed browser and return its screenshot, content height and bounded console output. Provide exactly one of html or path (inside the caller workspace). Inline scripts, styles and SVG; local PNG/JPEG/GIF/WebP images are embedded. Network resources, local files outside the workspace and browser permissions are unavailable. The first preview downloads a pinned Chrome for Testing once; each preview closes its browser. Pass the returned previewAttachmentId to html_render with the same source to retain the screenshot. Preview alone does not publish a reply.",
        inputSchema: toolInputSchema(VisualReplyPreviewInput),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      handler: (args, context) =>
        Effect.gen(function* () {
          const source = yield* Schema.decodeUnknownEffect(VisualReplyPreviewInput)(args);
          const prepared = yield* prepare(source, context);
          const result = yield* services.preview.capture({
            html: prepared.html,
            width: source.width ?? 960,
            height: source.height ?? 720,
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
          "Publish a persistent visual reply inline in the current Glade conversation, before your final written answer. Use it for charts, diagrams, galleries, interactive tables or mockups. Provide exactly one of html or path inside the caller workspace. Build self-contained HTML with inline styles, scripts and SVG; local raster images are embedded. Use CSS variables --glade-background, --glade-foreground, --glade-muted, --glade-accent, --glade-border, --glade-font-family and --glade-font-size to follow the reader's theme. Scripts run immediately inside an opaque sandbox; pages cannot access Glade APIs or the browser session. localStorage, sessionStorage and IndexedDB are unavailable; use in-memory state. Interactive plans and tables need actual editable inputs and functioning change/completion handlers; edits are transient. Make the initial HTML/SVG meaningful before scripts run and progressively enhance interactions. html_preview is an optional screenshot/console check for complex visuals or debugging, not a prerequisite. Its screenshot is for validation; readers see themed HTML. Publishing itself needs no extra browser. Do not repeat the visual in your final answer.",
        inputSchema: toolInputSchema(VisualReplyInput),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
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
          const attachment = yield* store({
            type: "file",
            bytes: Buffer.from(prepared.html),
            name: `${prepared.hash}.html`,
            mimeType: "text/html",
            context,
          });
          const reply: VisualReply = {
            version: 1,
            threadId: ThreadId.makeUnsafe(context.callerThreadId),
            title: source.title,
            attachmentId: attachment.id,
            ...(source.previewAttachmentId
              ? { previewAttachmentId: source.previewAttachmentId }
              : {}),
          };
          yield* Effect.gen(function* () {
            yield* context.assertCallerTurnActive();
            if (!context.callerTurnId)
              return yield* new VisualReplyError({
                message: "Publishing requires an active turn.",
              });
            const marker = randomUUID();
            const createdAt = new Date().toISOString();
            yield* services.engine.dispatch(
              {
                type: "thread.activity.append",
                commandId: CommandId.makeUnsafe(`visual:${marker}`),
                threadId: reply.threadId,
                activity: {
                  id: EventId.makeUnsafe(`visual:${marker}`),
                  kind: VISUAL_REPLY_ACTIVITY_KIND,
                  tone: "info",
                  summary: source.title,
                  payload: {
                    version: reply.version,
                    threadId: reply.threadId,
                    title: reply.title,
                    attachmentId: reply.attachmentId,
                    ...(reply.previewAttachmentId
                      ? { previewAttachmentId: reply.previewAttachmentId }
                      : {}),
                  },
                  turnId: TurnId.makeUnsafe(context.callerTurnId),
                  createdAt,
                },
                createdAt,
              },
              { attachmentPrincipal: principal },
            );
          }).pipe(Effect.ensuring(cancel(attachment.id, context)));
          return mcpToolResultJson({ published: true, ...reply });
        }).pipe(Effect.catch((error) => Effect.succeed(mcpToolResultError(errorText(error))))),
    },
  ];
}
