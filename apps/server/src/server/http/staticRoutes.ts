import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { Effect, FileSystem, Path } from "effect";
import { ServerConfig } from "../config";
import {
  isSidecarRequestPath,
  staticCacheControl,
  staticEtag,
  ifNoneMatchSatisfies,
  negotiateStaticEncodingPreference,
} from "./staticAssets";
import Mime from "@effect/platform-node/Mime";

export const staticAndDevEffectRouteLayer = HttpRouter.add(
  "GET",
  "*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (!url) return HttpServerResponse.text("Bad Request", { status: 400 });

    const config = yield* ServerConfig;
    if (config.devUrl) {
      return HttpServerResponse.redirect(config.devUrl.toString(), { status: 302 });
    }

    if (!config.staticDir) {
      return HttpServerResponse.text("No static directory configured and no dev URL set.", {
        status: 503,
      });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const staticRoot = path.resolve(config.staticDir);
    const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const rawRelativePath = requestPath.replace(/^[/\\]+/, "");
    const relativePath = path.normalize(rawRelativePath).replace(/^[/\\]+/, "");
    if (
      relativePath.length === 0 ||
      rawRelativePath.startsWith("..") ||
      relativePath.startsWith("..") ||
      relativePath.includes("\0")
    ) {
      return HttpServerResponse.text("Invalid static file path", { status: 400 });
    }
    if (isSidecarRequestPath(relativePath)) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    const isWithinStaticRoot = (candidate: string) =>
      candidate === staticRoot ||
      candidate.startsWith(staticRoot.endsWith(path.sep) ? staticRoot : `${staticRoot}${path.sep}`);

    // Lexical containment is not containment: stat and readFile follow symlinks, so a link inside the
    // root pointing outside it would be served. The root itself is canonicalized too, otherwise a
    // symlinked staticDir would fail its own check.
    const canonicalStaticRoot = yield* fileSystem
      .realPath(staticRoot)
      .pipe(Effect.catch(() => Effect.succeed(staticRoot)));
    const isWithinCanonicalRoot = (candidate: string) =>
      candidate === canonicalStaticRoot ||
      candidate.startsWith(
        canonicalStaticRoot.endsWith(path.sep)
          ? canonicalStaticRoot
          : `${canonicalStaticRoot}${path.sep}`,
      );
    const resolvesInsideRoot = Effect.fn(function* (candidate: string) {
      const real = yield* fileSystem
        .realPath(candidate)
        .pipe(Effect.catch(() => Effect.succeed(null)));

      return real === null ? false : isWithinCanonicalRoot(real);
    });

    let filePath = path.resolve(staticRoot, relativePath);
    if (!isWithinStaticRoot(filePath)) {
      return HttpServerResponse.text("Invalid static file path", { status: 400 });
    }
    if (!path.extname(filePath)) {
      filePath = path.resolve(filePath, "index.html");
      if (!isWithinStaticRoot(filePath)) {
        return HttpServerResponse.text("Invalid static file path", { status: 400 });
      }
    }

    const serveStaticFile = Effect.fn(function* (resolvedPath: string) {
      const cacheHeaders = {
        "Cache-Control": staticCacheControl(path.relative(staticRoot, resolvedPath)),
        Vary: "Accept-Encoding",
      };
      const ifNoneMatch = request.headers["if-none-match"];
      const baseContentType = Mime.getType(resolvedPath) ?? "application/octet-stream";
      const contentType =
        baseContentType === "text/html" ? "text/html; charset=utf-8" : baseContentType;
      const respond = Effect.fn(function* (servedPath: string, encoding?: string) {
        // Canonicalize before opening: a symlink inside the root pointing outside it passes the lexical
        // guard but must not be served.
        if (!(yield* resolvesInsideRoot(servedPath))) return null;
        const info = yield* fileSystem
          .stat(servedPath)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (!info || info.type !== "File") return null;
        const etag = staticEtag(Number(info.size), info.mtime?.getTime() ?? 0, encoding);
        const encodingHeaders = encoding ? { "Content-Encoding": encoding } : {};
        const headers = { ...cacheHeaders, ...encodingHeaders, ETag: etag };
        if (ifNoneMatchSatisfies(ifNoneMatch, etag)) {
          return HttpServerResponse.empty({ status: 304, headers });
        }
        const data = yield* fileSystem
          .readFile(servedPath)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (!data) return null;
        return HttpServerResponse.uint8Array(data, { status: 200, contentType, headers });
      });
      const preference = negotiateStaticEncodingPreference(request.headers["accept-encoding"]);

      for (const candidate of preference.candidates) {
        if (candidate === null) {
          const identityResponse = yield* respond(resolvedPath);
          if (identityResponse) return identityResponse;
          continue;
        }
        const sidecarPath = `${resolvedPath}${candidate.sidecarExtension}`;
        // Sidecars share the traversal guard with their source file: appending an extension cannot escape
        // the root, but keep the invariant explicit.
        if (!isWithinStaticRoot(sidecarPath)) continue;
        const sidecarResponse = yield* respond(sidecarPath, candidate.encoding);
        if (sidecarResponse) return sidecarResponse;
      }
      // Nothing acceptable was servable. With identity excluded that is a 406 per RFC 9110 §12.5.3;
      // otherwise the file itself is missing.
      if (!preference.identityAcceptable) {
        return HttpServerResponse.text("Not Acceptable", {
          status: 406,
          headers: { Vary: "Accept-Encoding" },
        });
      }
      return null;
    });

    const fileInfo = yield* fileSystem
      .stat(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") {
      const fallback = yield* serveStaticFile(path.resolve(staticRoot, "index.html"));
      return fallback ?? HttpServerResponse.text("Not Found", { status: 404 });
    }

    const response = yield* serveStaticFile(filePath);
    return response ?? HttpServerResponse.text("Internal Server Error", { status: 500 });
  }),
);
