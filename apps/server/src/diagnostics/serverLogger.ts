import { Effect, Logger } from "effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../server/config";
import {
  ensurePrivateDirectorySync,
  ensurePrivateFileSync,
} from "../platform/filesystem/privatePathPermissions";

export const ServerLoggerLive = Effect.gen(function* () {
  const { logsDir, serverLogPath } = yield* ServerConfig;

  yield* Effect.sync(() => {
    ensurePrivateDirectorySync(logsDir);
    ensurePrivateFileSync(serverLogPath);
  });

  const fileLogger = Logger.formatSimple.pipe(Logger.toFile(serverLogPath));

  return Logger.layer([Logger.defaultLogger, fileLogger], {
    mergeWithExisting: false,
  });
}).pipe(Layer.unwrap);
