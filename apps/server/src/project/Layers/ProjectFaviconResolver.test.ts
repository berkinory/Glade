import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import { expect } from "vitest";
import { ProjectFaviconResolver } from "../Services/ProjectFaviconResolver";
import { ProjectFaviconResolverLive } from "./ProjectFaviconResolver";

it.layer(ProjectFaviconResolverLive.pipe(Layer.provideMerge(NodeServices.layer)))(
  "project icon boundary",
  (it) => {
    it.effect("rejects escaped file and frontend symlinks while preserving root priority", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const resolver = yield* ProjectFaviconResolver;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "glade-icon-" });
        const outside = yield* fs.makeTempDirectoryScoped({ prefix: "glade-icon-outside-" });
        yield* fs.writeFileString(`${outside}/favicon.svg`, "<svg/>");
        yield* fs.symlink(`${outside}/favicon.svg`, `${root}/favicon.svg`);
        yield* fs.symlink(outside, `${root}/web`);
        expect(yield* resolver.resolvePath(root)).toBeNull();
        yield* fs.makeDirectory(`${root}/apps/web/public`, { recursive: true });
        yield* fs.writeFileString(`${root}/apps/web/public/favicon.svg`, "<svg/>");
        const canonical = yield* fs.realPath(root);
        expect(yield* resolver.resolvePath(root)).toBe(`${canonical}/apps/web/public/favicon.svg`);
        yield* fs.writeFileString(`${root}/favicon.ico`, "root");
        expect(yield* resolver.resolvePath(root)).toBe(`${canonical}/favicon.ico`);
      }),
    );
  },
);
