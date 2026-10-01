import { type ServerConfigShape, ServerConfig } from "../config";
import nodePath from "node:path";
import { Effect, FileSystem } from "effect";
import { resolveCachedEditorIcon } from "../../workspace/editor/editorAppIcons";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { EDITOR_ICON_ROUTE_PATH } from "@glade/shared/workspace/editorIcons";
import { authErrorResponse } from "../../auth/effectHttp";
import { HttpPayload, toEffectHttpResponse } from "./httpResponse";
import { isLegacyTokenAuthorized, requireAuthenticatedRequest } from "./requestAuthorization";

const EDITOR_ICON_CACHE_CONTROL_SUCCESS = "public, max-age=86400";

function resolveEditorIconCacheDir(config: ServerConfigShape): string {
  return nodePath.join(config.stateDir, "app-icons");
}

function resolveEditorIconEnv(config: ServerConfigShape): NodeJS.ProcessEnv {
  return { ...process.env, HOME: config.homeDir };
}

const resolveEditorIconHttpPayload = Effect.fn(function* (input: {
  readonly url: URL;
  readonly serverConfig: ServerConfigShape;
  readonly fileSystem: FileSystem.FileSystem;
}) {
  const editorId = input.url.searchParams.get("id");
  if (!editorId) {
    return {
      statusCode: 400,
      contentType: "text/plain",
      body: "Missing id parameter",
    } satisfies HttpPayload;
  }

  const icon = yield* Effect.promise(() =>
    resolveCachedEditorIcon({
      editorId,
      cacheDir: resolveEditorIconCacheDir(input.serverConfig),
      env: resolveEditorIconEnv(input.serverConfig),
    }),
  );
  if (!icon) {
    return {
      statusCode: 404,
      contentType: "text/plain",
      body: "Not Found",
    } satisfies HttpPayload;
  }

  const data = yield* input.fileSystem
    .readFile(icon.path)
    .pipe(Effect.catch(() => Effect.succeed(null)));
  if (!data) {
    return {
      statusCode: 404,
      contentType: "text/plain",
      body: "Not Found",
    } satisfies HttpPayload;
  }

  return {
    statusCode: 200,
    contentType: icon.contentType,
    headers: { "Cache-Control": EDITOR_ICON_CACHE_CONTROL_SUCCESS },
    body: data,
  } satisfies HttpPayload;
});

export const editorIconEffectRouteLayer = HttpRouter.add(
  "GET",
  EDITOR_ICON_ROUTE_PATH,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (!url) return HttpServerResponse.text("Bad Request", { status: 400 });

    const config = yield* ServerConfig;
    if (!isLegacyTokenAuthorized({ config, url })) {
      yield* requireAuthenticatedRequest;
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const payload = yield* resolveEditorIconHttpPayload({
      url,
      serverConfig: config,
      fileSystem,
    });
    return toEffectHttpResponse(payload);
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);
