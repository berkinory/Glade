import { createHash } from "node:crypto";
import { parse, serialize } from "parse5";
import { Effect, FileSystem, Option, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { EventId, ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  VisualReply,
  VISUAL_REPLY_ACTIVITY_KIND,
  VISUAL_REPLY_MAX_DOCUMENT_BYTES,
  VISUAL_REPLY_ROUTE,
} from "@glade/contracts/orchestration/visualReply";
import { ServerConfig } from "../server/config";
import { ManagedAttachmentRepository } from "../persistence/Services/ManagedAttachments";
import { ProjectionThreadActivityRepository } from "../persistence/Services/ProjectionThreadActivities";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import { resolveAttachmentRelativePath } from "../attachments/attachmentPaths";
import { authErrorResponse } from "../auth/effectHttp";
import {
  isLegacyTokenAuthorized,
  requireAuthenticatedRequest,
} from "../server/http/requestAuthorization";
import { localPreviewCorsHeaders } from "../server/http/httpResponse";

export const visualReplyRouteLayer = HttpRouter.add(
  "GET",
  VISUAL_REPLY_ROUTE,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (!url) return HttpServerResponse.text("Bad Request", { status: 400 });
    const config = yield* ServerConfig;
    if (!isLegacyTokenAuthorized({ config, url })) yield* requireAuthenticatedRequest;
    const cors = localPreviewCorsHeaders({ config, request, url });
    const headers = {
      ...cors,
      ...(cors["Access-Control-Allow-Origin"]
        ? { "Access-Control-Allow-Credentials": "true" }
        : {}),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    };
    const notFound = () => HttpServerResponse.text("Not Found", { status: 404, headers });
    const threadId = Schema.decodeUnknownOption(ThreadId)(url.searchParams.get("threadId"));
    const activityId = Schema.decodeUnknownOption(EventId)(url.searchParams.get("activityId"));
    if (Option.isNone(threadId) || Option.isNone(activityId))
      return HttpServerResponse.text("Invalid reply reference", { status: 400, headers });
    const snapshots = yield* ProjectionSnapshotQuery;
    const thread = yield* snapshots.getThreadShellById(threadId.value);
    if (Option.isNone(thread)) return notFound();
    const activities = yield* ProjectionThreadActivityRepository;
    const activity = yield* activities.getById({
      threadId: threadId.value,
      activityId: activityId.value,
    });
    if (Option.isNone(activity) || activity.value.kind !== VISUAL_REPLY_ACTIVITY_KIND)
      return notFound();
    const reply = Schema.decodeUnknownOption(VisualReply)(activity.value.payload);
    if (Option.isNone(reply) || reply.value.threadId !== threadId.value) return notFound();
    const attachments = yield* ManagedAttachmentRepository;
    const blob = yield* attachments.findClaimedById({ attachmentId: reply.value.attachmentId });
    if (
      Option.isNone(blob) ||
      blob.value.ownerThreadId !== threadId.value ||
      blob.value.claimMessageId !== activityId.value ||
      blob.value.purpose !== "visual-reply" ||
      blob.value.mimeType !== "text/html" ||
      blob.value.sizeBytes === null ||
      blob.value.sizeBytes > VISUAL_REPLY_MAX_DOCUMENT_BYTES
    )
      return notFound();
    const filePath = resolveAttachmentRelativePath({
      attachmentsDir: config.attachmentsDir,
      relativePath: blob.value.relativePath,
    });
    if (!filePath) return notFound();
    const fs = yield* FileSystem.FileSystem;
    const stat = yield* fs.stat(filePath).pipe(Effect.option);
    if (
      Option.isNone(stat) ||
      stat.value.type !== "File" ||
      Number(stat.value.size) !== blob.value.sizeBytes
    )
      return notFound();
    const bytes = yield* fs.readFile(filePath).pipe(Effect.option);
    if (
      Option.isNone(bytes) ||
      createHash("sha256").update(bytes.value).digest("hex") !== blob.value.sha256
    )
      return notFound();
    // Never serve executable HTML on Glade's authenticated origin. Canonical parsing also makes
    // the client's first-head CSP injection safe for any stored document, including imported data.
    const html = serialize(parse(Buffer.from(bytes.value).toString("utf8")));
    return HttpServerResponse.text(html, { contentType: "text/plain; charset=utf-8", headers });
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);
