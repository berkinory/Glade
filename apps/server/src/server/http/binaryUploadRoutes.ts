import { Effect, Layer } from "effect";
import { HttpServerRequest, HttpServerResponse, HttpRouter } from "effect/unstable/http";
import { ServerConfig } from "../config";
import {
  LOCAL_LOOPBACK_ATTACHMENT_PRINCIPAL,
  attachmentPrincipalForSession,
} from "../../attachments/managedAttachmentPrincipal";
import {
  ATTACHMENT_UPLOAD_ROUTE_PATH,
  ATTACHMENT_CANCEL_ROUTE_PATH,
  VOICE_TRANSCRIPTION_UPLOAD_ROUTE_PATH,
} from "@glade/shared/transport/binaryTransfer";
import {
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
} from "@glade/contracts/orchestration/threadEntities";
import { ManagedAttachmentRepository } from "../../persistence/Services/ManagedAttachments";
import {
  reserveManagedAttachmentUpload,
  persistReservedManagedAttachment,
} from "../../attachments/managedAttachmentStore";
import {
  voiceUploadAdmissionGate,
  VOICE_UPLOAD_CAPACITY_ERROR_MESSAGE,
} from "../../voice/voiceUploadAdmission";
import { SERVER_VOICE_TRANSCRIPTION_MAX_AUDIO_BYTES } from "@glade/contracts/server/server";
import { ProviderAdapterRegistry } from "../../provider/Services/ProviderAdapterRegistry";
import { ServerSettingsService } from "../../settings/serverSettings";
import { getEnabledProviderAdapter } from "../../provider/core/enabledProviderAdapter";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { AuthError } from "../../auth/Services/ServerAuth";
import { authErrorResponse } from "../../auth/effectHttp";
import {
  trustedMutationCorsHeaders,
  isLegacyTokenAuthorized,
  requireAuthenticatedMutationRequest,
} from "./requestAuthorization";
import { readEffectBinary, readEffectJson } from "./httpBody";

const binaryUploadEffectHandler = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const url = HttpServerRequest.toURL(request);
  if (!url) return HttpServerResponse.text("Bad Request", { status: 400 });
  const config = yield* ServerConfig;
  const corsHeaders = trustedMutationCorsHeaders({ request, url, config });
  if (corsHeaders === null) {
    return HttpServerResponse.jsonUnsafe(
      { error: "Trusted request origin required." },
      { status: 403 },
    );
  }
  if (request.method === "OPTIONS") {
    return HttpServerResponse.empty({ status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return HttpServerResponse.text("Method Not Allowed", { status: 405, headers: corsHeaders });
  }
  const attachmentPrincipal = isLegacyTokenAuthorized({ config, url })
    ? LOCAL_LOOPBACK_ATTACHMENT_PRINCIPAL
    : attachmentPrincipalForSession((yield* requireAuthenticatedMutationRequest).sessionId);

  if (url.pathname === ATTACHMENT_UPLOAD_ROUTE_PATH) {
    const type = url.searchParams.get("type");
    const threadId = url.searchParams.get("threadId")?.trim() ?? "";
    const name = url.searchParams.get("name") ?? "";
    const mimeType = url.searchParams.get("mimeType") ?? "";
    if ((type !== "image" && type !== "file") || !threadId || !name || !mimeType) {
      return HttpServerResponse.jsonUnsafe(
        { error: "Attachment upload metadata is invalid." },
        { status: 400, headers: corsHeaders },
      );
    }
    const maxBytes =
      type === "image" ? PROVIDER_SEND_TURN_MAX_IMAGE_BYTES : PROVIDER_SEND_TURN_MAX_FILE_BYTES;
    const declaredLength = Number(request.headers["content-length"] ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return HttpServerResponse.jsonUnsafe(
        { error: "Request body too large." },
        { status: 413, headers: corsHeaders },
      );
    }
    const reservedBytes =
      Number.isSafeInteger(declaredLength) && declaredLength > 0 && declaredLength <= maxBytes
        ? declaredLength
        : maxBytes;
    const repository = yield* ManagedAttachmentRepository;
    const now = new Date().toISOString();
    const reservation = yield* reserveManagedAttachmentUpload({
      type,
      threadId,
      name,
      mimeType,
      reservedBytes,
      now,
      principal: attachmentPrincipal,
      repository,
    });
    const bytes = yield* readEffectBinary(request, maxBytes).pipe(
      Effect.tapError(() =>
        repository
          .cancelStaged({
            attachmentId: reservation.attachmentId,
            ownerKind: attachmentPrincipal.ownerKind,
            ownerId: attachmentPrincipal.ownerId,
            reason: "upload-body-failed",
            requestedAt: new Date().toISOString(),
          })
          .pipe(Effect.ignore),
      ),
    );
    const attachment = yield* persistReservedManagedAttachment({
      reservation,
      bytes,
      attachmentsDir: config.attachmentsDir,
      now: new Date().toISOString(),
      principal: attachmentPrincipal,
      repository,
    });
    return HttpServerResponse.jsonUnsafe(attachment, { status: 201, headers: corsHeaders });
  }

  if (url.pathname === ATTACHMENT_CANCEL_ROUTE_PATH) {
    const payload = yield* readEffectJson(request, "Invalid attachment cancellation payload.");
    const attachmentId =
      payload && typeof payload === "object" && "attachmentId" in payload
        ? String((payload as { readonly attachmentId?: unknown }).attachmentId ?? "").trim()
        : "";
    if (!attachmentId || attachmentId.length > 128 || !/^[a-z0-9_-]+$/iu.test(attachmentId)) {
      return HttpServerResponse.jsonUnsafe(
        { error: "Attachment cancellation payload is invalid." },
        { status: 400, headers: corsHeaders },
      );
    }
    const repository = yield* ManagedAttachmentRepository;
    const result = yield* repository.cancelStaged({
      attachmentId,
      ownerKind: attachmentPrincipal.ownerKind,
      ownerId: attachmentPrincipal.ownerId,
      reason: "client-cancelled",
      requestedAt: new Date().toISOString(),
    });
    if (result.status === "not-found") {
      return HttpServerResponse.jsonUnsafe(
        { error: "Attachment not found." },
        { status: 404, headers: corsHeaders },
      );
    }
    if (result.status === "already-claimed") {
      return HttpServerResponse.jsonUnsafe(
        { error: "Attachment is already committed." },
        { status: 409, headers: corsHeaders },
      );
    }
    return HttpServerResponse.jsonUnsafe(
      { cancelled: true },
      { status: 200, headers: corsHeaders },
    );
  }

  if (url.pathname === VOICE_TRANSCRIPTION_UPLOAD_ROUTE_PATH) {
    const provider = url.searchParams.get("provider")?.trim() ?? "";
    const cwd = url.searchParams.get("cwd")?.trim() ?? "";
    const threadId = url.searchParams.get("threadId")?.trim() || undefined;
    const mimeType = url.searchParams.get("mimeType")?.trim() ?? "";
    const sampleRateHz = Number(url.searchParams.get("sampleRateHz"));
    const durationMs = Number(url.searchParams.get("durationMs"));
    if (
      !provider ||
      !cwd ||
      !mimeType ||
      !Number.isSafeInteger(sampleRateHz) ||
      !Number.isSafeInteger(durationMs)
    ) {
      return HttpServerResponse.jsonUnsafe(
        { error: "Voice transcription metadata is invalid." },
        { status: 400, headers: corsHeaders },
      );
    }
    const releaseUpload = voiceUploadAdmissionGate.tryAcquire();
    if (!releaseUpload) {
      return HttpServerResponse.jsonUnsafe(
        { error: VOICE_UPLOAD_CAPACITY_ERROR_MESSAGE },
        { status: 429, headers: corsHeaders },
      );
    }
    return yield* Effect.gen(function* () {
      const bytes = yield* readEffectBinary(request, SERVER_VOICE_TRANSCRIPTION_MAX_AUDIO_BYTES);
      const registry = yield* ProviderAdapterRegistry;
      const serverSettings = yield* ServerSettingsService;
      const adapter = yield* getEnabledProviderAdapter(provider as never, serverSettings, registry);
      if (!adapter.transcribeVoice) {
        return HttpServerResponse.jsonUnsafe(
          { error: `Voice transcription is unavailable for provider '${provider}'.` },
          { status: 400, headers: corsHeaders },
        );
      }
      const result = yield* adapter.transcribeVoice({
        provider: provider as never,
        cwd,
        ...(threadId ? { threadId: ThreadId.makeUnsafe(threadId) } : {}),
        mimeType,
        sampleRateHz,
        durationMs,
        audioBase64: Buffer.from(bytes).toString("base64"),
      });
      return HttpServerResponse.jsonUnsafe(result, { status: 200, headers: corsHeaders });
    }).pipe(Effect.ensuring(Effect.sync(releaseUpload)));
  }

  return HttpServerResponse.text("Not Found", { status: 404, headers: corsHeaders });
}).pipe(
  Effect.catch((error) =>
    Effect.succeed(
      error instanceof AuthError
        ? authErrorResponse(error)
        : HttpServerResponse.jsonUnsafe(
            {
              error:
                error instanceof Error
                  ? error.message
                  : String((error as { readonly message?: unknown }).message ?? error),
            },
            {
              status:
                typeof (error as { readonly status?: unknown }).status === "number"
                  ? (error as { readonly status: number }).status
                  : 500,
            },
          ),
    ),
  ),
);

export const binaryUploadEffectRouteLayer = Layer.merge(
  HttpRouter.add("*", ATTACHMENT_UPLOAD_ROUTE_PATH, binaryUploadEffectHandler),
  Layer.merge(
    HttpRouter.add("*", ATTACHMENT_CANCEL_ROUTE_PATH, binaryUploadEffectHandler),
    HttpRouter.add("*", VOICE_TRANSCRIPTION_UPLOAD_ROUTE_PATH, binaryUploadEffectHandler),
  ),
);
