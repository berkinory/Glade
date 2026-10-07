import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { Effect, FileSystem } from "effect";
import { ProjectFaviconResolver } from "../../project/Services/ProjectFaviconResolver";
import nodePath from "node:path";
import { authErrorResponse } from "../../auth/effectHttp";
import { ServerConfig } from "../config";
import { tryParseHost, resolveFavicon } from "./siteFaviconCache";
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

const FALLBACK_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" color="currentColor" class="" stroke-width="1.5" stroke="#6b728080" data-fallback="project-favicon"><path d="M8 7H16.75C18.8567 7 19.91 7 20.6667 7.50559C20.9943 7.72447 21.2755 8.00572 21.4944 8.33329C22 9.08996 22 10.1433 22 12.25C22 15.7612 22 17.5167 21.1573 18.7779C20.7926 19.3238 20.3238 19.7926 19.7779 20.1573C18.5167 21 16.7612 21 13.25 21H12C7.28595 21 4.92893 21 3.46447 19.5355C2 18.0711 2 15.714 2 11V7.94427C2 6.1278 2 5.21956 2.38032 4.53806C2.65142 4.05227 3.05227 3.65142 3.53806 3.38032C4.21956 3 5.1278 3 6.94427 3C8.10802 3 8.6899 3 9.19926 3.19101C10.3622 3.62712 10.8418 4.68358 11.3666 5.73313L12 7" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"></path></svg>`;

const FALLBACK_SITE_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" color="currentColor" class="" stroke-width="1.5" stroke="#6b728080" data-fallback="site-favicon"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"></circle><path d="M8 12C8 18 12 22 12 22C12 22 16 18 16 12C16 6 12 2 12 2C12 2 8 6 8 12Z" stroke="currentColor" stroke-linejoin="round" stroke-width="1.5"></path><path d="M21 15H3" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path><path d="M21 9H3" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path></svg>`;
