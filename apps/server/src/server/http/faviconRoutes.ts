import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { Effect, FileSystem } from "effect";
import { ProjectFaviconResolver } from "../../project/Services/ProjectFaviconResolver";
import nodePath from "node:path";
import { authErrorResponse } from "../../auth/effectHttp";
import { ServerConfig } from "../config";
import { tryParseHost, resolveFavicon } from "../../browser/siteFaviconCache";
import { requireAuthenticatedRequest, isLegacyTokenAuthorized } from "./requestAuthorization";
import { streamedFileResponse, SVG_DOCUMENT_SECURITY_HEADERS } from "./httpResponse";

const PROJECT_FAVICON_CACHE_CONTROL = "public, max-age=3600";

const SITE_FAVICON_CACHE_CONTROL_SUCCESS = "public, max-age=86400";

const SITE_FAVICON_CACHE_CONTROL_FALLBACK = "public, max-age=3600";

export const projectFaviconEffectRouteLayer = HttpRouter.add(
  "GET",
  "/api/project-favicon",
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (!url) return HttpServerResponse.text("Bad Request", { status: 400 });
    if (!isLegacyTokenAuthorized({ config, url })) {
      yield* requireAuthenticatedRequest;
    }
    const projectCwd = url.searchParams.get("cwd");
    if (!projectCwd) return HttpServerResponse.text("Missing cwd parameter", { status: 400 });
    const resolver = yield* ProjectFaviconResolver;
    const faviconPath = yield* resolver.resolvePath(projectCwd);
    if (!faviconPath) {
      if (url.searchParams.get("fallback") === "none")
        return HttpServerResponse.empty({ status: 204 });
      return HttpServerResponse.text(FALLBACK_FAVICON_SVG, {
        status: 200,
        contentType: "image/svg+xml",
        headers: {
          "Cache-Control": PROJECT_FAVICON_CACHE_CONTROL,
          ...SVG_DOCUMENT_SECURITY_HEADERS,
        },
      });
    }
    const fileSystem = yield* FileSystem.FileSystem;
    const stats = yield* fileSystem.stat(faviconPath);
    return streamedFileResponse({
      fileSystem,
      path: faviconPath,
      sizeBytes: Number(stats.size),
      headers: {
        "Cache-Control": PROJECT_FAVICON_CACHE_CONTROL,
        ...(nodePath.extname(faviconPath).toLowerCase() === ".svg"
          ? SVG_DOCUMENT_SECURITY_HEADERS
          : {}),
      },
    });
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);

export const siteFaviconEffectRouteLayer = HttpRouter.add(
  "GET",
  "/api/site-favicon",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (!url) return HttpServerResponse.text("Bad Request", { status: 400 });

    const config = yield* ServerConfig;
    if (!isLegacyTokenAuthorized({ config, url })) {
      yield* requireAuthenticatedRequest;
    }

    const domainParam = url.searchParams.get("domain") ?? url.searchParams.get("url");
    if (!domainParam) return HttpServerResponse.text("Missing domain parameter", { status: 400 });
    const host = tryParseHost(domainParam);
    if (!host) return HttpServerResponse.text("Invalid domain", { status: 400 });

    const favicon = yield* Effect.promise(() => resolveFavicon(host));
    if (!favicon.bytes) {
      return HttpServerResponse.text(FALLBACK_SITE_FAVICON_SVG, {
        status: 200,
        contentType: "image/svg+xml",
        headers: {
          "Cache-Control": SITE_FAVICON_CACHE_CONTROL_FALLBACK,
          ...SVG_DOCUMENT_SECURITY_HEADERS,
        },
      });
    }
    return HttpServerResponse.uint8Array(favicon.bytes, {
      status: 200,
      contentType: favicon.contentType ?? "image/x-icon",
      headers: {
        "Cache-Control": SITE_FAVICON_CACHE_CONTROL_SUCCESS,
        ...(favicon.contentType?.toLowerCase().startsWith("image/svg+xml")
          ? SVG_DOCUMENT_SECURITY_HEADERS
          : {}),
      },
    });
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);

const FALLBACK_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6b728080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-fallback="project-favicon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/></svg>`;

const FALLBACK_SITE_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6b728080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-fallback="site-favicon"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20M12 2a14.5 14.5 0 0 1 0 20M2 12h20"/></svg>`;
