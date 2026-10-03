import { downloadDisposition } from "./downloadDisposition";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import {
  LOCAL_IMAGE_ROUTE_PATH,
  resolveAllowedLocalPreviewFile,
} from "../../attachments/localImageFiles.ts";
import { Effect, FileSystem, Option } from "effect";
import { ServerConfig } from "../config";
import { resolveScratchWorkspacesRoot } from "../../workspace/scratchWorkspaces.ts";
import nodePath from "node:path";
import { authErrorResponse } from "../../auth/effectHttp";
import {
  ATTACHMENTS_ROUTE_PREFIX,
  normalizeAttachmentRelativePath,
  resolveAttachmentRelativePath,
} from "../../attachments/attachmentPaths";
import { ManagedAttachmentRepository } from "../../persistence/Services/ManagedAttachments";
import { resolveAttachmentPathById } from "../../attachments/attachmentStore.ts";
import { isLegacyTokenAuthorized, requireAuthenticatedRequest } from "./requestAuthorization";
import {
  localPreviewCorsHeaders,
  streamedFileResponse,
  SVG_DOCUMENT_SECURITY_HEADERS,
} from "./httpResponse";

export const localImageEffectRouteLayer = HttpRouter.add(
  "GET",
  LOCAL_IMAGE_ROUTE_PATH,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (!url) return HttpServerResponse.text("Bad Request", { status: 400 });

    const config = yield* ServerConfig;
    if (!isLegacyTokenAuthorized({ config, url })) {
      yield* requireAuthenticatedRequest;
    }

    const previewFile = yield* Effect.promise(() =>
      resolveAllowedLocalPreviewFile({
        requestedPath: url.searchParams.get("path"),
        cwd: url.searchParams.get("cwd"),
        scratchWorkspacesRoot: resolveScratchWorkspacesRoot(),
        allowAbsoluteLocalPreviewFile: true,
        previewGrant: url.searchParams.get("grant"),
      }).catch(() => null),
    );
    if (!previewFile) {
      return HttpServerResponse.text("Not Found", {
        status: 404,
        headers: localPreviewCorsHeaders({ config, request, url }),
      });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const isDownload = url.searchParams.get("download") === "1";
    const isSvg = nodePath.extname(previewFile.path).toLowerCase() === ".svg";
    return streamedFileResponse({
      fileSystem,
      path: previewFile.path,
      sizeBytes: previewFile.sizeBytes,
      headers: {
        "Cache-Control": "private, max-age=60",
        // Reflect only those trusted origins: auth-token-less local servers must not expose workspace files
        // to any random web page that can guess path/cwd query params.
        ...localPreviewCorsHeaders({ config, request, url }),

        "X-Content-Type-Options": "nosniff",
        ...(isSvg ? SVG_DOCUMENT_SECURITY_HEADERS : {}),
        ...(isDownload ? { "Content-Disposition": downloadDisposition(previewFile.fileName) } : {}),
      },
    });
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);

export const attachmentsEffectRouteLayer = HttpRouter.add(
  "GET",
  `${ATTACHMENTS_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (!url) return HttpServerResponse.text("Bad Request", { status: 400 });

    const config = yield* ServerConfig;

    if (!isLegacyTokenAuthorized({ config, url })) {
      yield* requireAuthenticatedRequest;
    }

    const rawRelativePath = url.pathname.slice(ATTACHMENTS_ROUTE_PREFIX.length);
    const normalizedRelativePath = normalizeAttachmentRelativePath(rawRelativePath);
    if (!normalizedRelativePath) {
      return HttpServerResponse.text("Invalid attachment path", { status: 400 });
    }
    if (
      normalizedRelativePath.startsWith("objects/") ||
      normalizedRelativePath.startsWith(".staging/")
    ) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    const isIdLookup =
      !normalizedRelativePath.includes("/") && !normalizedRelativePath.includes(".");
    const managedBlob =
      isIdLookup && normalizedRelativePath.startsWith("att_v2_")
        ? yield* (yield* ManagedAttachmentRepository).findClaimedById({
            attachmentId: normalizedRelativePath,
          })
        : Option.none();
    const filePath = Option.isSome(managedBlob)
      ? resolveAttachmentRelativePath({
          attachmentsDir: config.attachmentsDir,
          relativePath: managedBlob.value.relativePath,
        })
      : isIdLookup && !normalizedRelativePath.startsWith("att_v2_")
        ? resolveAttachmentPathById({
            attachmentsDir: config.attachmentsDir,
            attachmentId: normalizedRelativePath,
          })
        : !isIdLookup
          ? resolveAttachmentRelativePath({
              attachmentsDir: config.attachmentsDir,
              relativePath: normalizedRelativePath,
            })
          : null;
    if (!filePath) {
      return HttpServerResponse.text(isIdLookup ? "Not Found" : "Invalid attachment path", {
        status: isIdLookup ? 404 : 400,
      });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const fileInfo = yield* fileSystem
      .stat(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }
    if (
      Option.isSome(managedBlob) &&
      managedBlob.value.sizeBytes !== null &&
      Number(fileInfo.size) !== managedBlob.value.sizeBytes
    ) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    return streamedFileResponse({
      fileSystem,
      path: filePath,
      sizeBytes: Number(fileInfo.size),

      headers: {
        "Cache-Control": "private, no-store",
        Pragma: "no-cache",
      },
    });
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);
