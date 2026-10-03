import { downloadDisposition } from "./downloadDisposition";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { Effect, Option, Stream } from "effect";
import { ServerConfig } from "../config";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { threadExportBlockedReason } from "@glade/shared/threads/threadExport";
import {
  threadArchiveFileName,
  threadArchiveChunks,
} from "../../orchestration/exportThreadArchive";
import { authErrorResponse } from "../../auth/effectHttp";
import { isLegacyTokenAuthorized, requireAuthenticatedRequest } from "./requestAuthorization";
import { localPreviewCorsHeaders } from "./httpResponse";

export const threadExportEffectRouteLayer = HttpRouter.add(
  "GET",
  "/api/thread-export",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (!url) return HttpServerResponse.text("Bad Request", { status: 400 });

    const config = yield* ServerConfig;
    if (!isLegacyTokenAuthorized({ config, url })) {
      yield* requireAuthenticatedRequest;
    }

    const corsHeaders = localPreviewCorsHeaders({ config, request, url });

    const threadIdParam = url.searchParams.get("threadId")?.trim();
    if (!threadIdParam)
      return HttpServerResponse.text("Missing threadId parameter", {
        status: 400,
        headers: corsHeaders,
      });

    const snapshotQuery = yield* ProjectionSnapshotQuery;
    const threadOption = yield* snapshotQuery.getThreadDetailForExportById(
      ThreadId.makeUnsafe(threadIdParam),
    );
    if (Option.isNone(threadOption))
      return HttpServerResponse.text("Not Found", { status: 404, headers: corsHeaders });
    const thread = threadOption.value;

    const blockedReason = threadExportBlockedReason(thread);
    if (blockedReason !== null) {
      return HttpServerResponse.text(blockedReason, { status: 409, headers: corsHeaders });
    }

    const fileName = threadArchiveFileName({ title: thread.title, isoTimestamp: thread.updatedAt });
    return HttpServerResponse.stream(
      Stream.fromAsyncIterable(threadArchiveChunks(thread), (cause) => cause),
      {
        status: 200,
        contentType: "application/zip",
        headers: {
          "Content-Disposition": downloadDisposition(fileName),
          "Cache-Control": "no-store",
          ...corsHeaders,
          "Access-Control-Expose-Headers": "Content-Disposition",
        },
      },
    );
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);
