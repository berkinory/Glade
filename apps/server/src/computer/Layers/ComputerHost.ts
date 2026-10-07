import {
  COMPUTER_CONNECTION_NOTIFICATION,
  COMPUTER_DISPLAYS_METHOD,
  COMPUTER_ENCODE_JPEG_METHOD,
  COMPUTER_KILL_SWITCH_NOTIFICATION,
  COMPUTER_USER_IDLE_METHOD,
  ComputerConnection,
  ComputerDisplays,
  ComputerEncodedImage,
  ComputerUserIdle,
} from "@glade/contracts/computer/computerHost";
import { Effect, Layer, Option, Schedule, Schema, Stream, SubscriptionRef } from "effect";
import * as Crypto from "node:crypto";

import { DesktopHostClient } from "../../desktopHost/Services/DesktopHostClient.ts";
import { CuaMcpFailure, openCuaMcpClient, type CuaMcpClient } from "../cuaMcpClient.ts";
import { CuaHealth, CuaPermissions, CuaToolResult, resultText } from "../cuaResults.ts";
import {
  ComputerHost,
  ComputerHostError,
  type ComputerHostShape,
  type ComputerStatus,
} from "../Services/ComputerHost.ts";

const HEALTH_TIMEOUT_MS = 10_000;
const END_SESSION_TIMEOUT_MS = 5_000;
const SESSION_ENDED = /session has ended/u;
const ENCODE_TIMEOUT_MS = 10_000;
const HOST_QUERY_TIMEOUT_MS = 2_000;
const JPEG_QUALITY = 75;
// A proxy that dies while its daemon generation is still current is relaunched quickly at first,
// then every few seconds.
const RELAUNCH = Schedule.exponential("250 millis").pipe(
  Schedule.either(Schedule.spaced("5 seconds")),
);

const toHostError = (error: unknown) =>
  error instanceof CuaMcpFailure
    ? new ComputerHostError({ code: error.code, message: error.message })
    : new ComputerHostError({ code: "protocol", message: String(error) });

const unavailable = (
  reason: Extract<ComputerStatus, { state: "unavailable" }>["reason"],
  message: string,
): ComputerStatus => ({ state: "unavailable", reason, message });

export const ComputerHostLive = Layer.effect(
  ComputerHost,
  Effect.gen(function* () {
    const desktopHost = yield* DesktopHostClient;
    const status = yield* SubscriptionRef.make<ComputerStatus>(
      unavailable("starting", "Waiting for the Glade desktop app to start Cua Driver."),
    );
    // The proxy of the current driver generation, owned by the generation fiber below, and the Cua
    // session label of each thread on it. Cua binds a named session to the connection that created
    // it and never revives an ended one from another, so labels are unique per connection and a
    // thread gets a fresh label after its session ends. The daemon outlives a backend restart and
    // remembers the ended labels of the previous backend, so each server process adds its own
    // nonce.
    let client: { readonly mcp: CuaMcpClient; readonly sessions: Map<string, string> } | null =
      null;
    let labelCount = 0;
    const processNonce = Crypto.randomBytes(3).toString("hex");
    const threadHash = (threadId: string) =>
      Crypto.createHash("sha256").update(threadId).digest("hex").slice(0, 8);
    const sessionLabel = (sessions: Map<string, string>, threadId: string) => {
      let label = sessions.get(threadId);
      if (!label) {
        labelCount += 1;
        label = `glade-${threadHash(threadId)}-${processNonce}${labelCount.toString(36)}`;
        sessions.set(threadId, label);
      }
      return label;
    };

    const request = (current: CuaMcpClient, name: string, args: unknown, timeoutMs: number) =>
      Effect.tryPromise({
        try: (signal) => current.request("tools/call", { name, arguments: args }, signal),
        catch: toHostError,
      }).pipe(
        Effect.timeoutOrElse({
          duration: timeoutMs,
          onTimeout: () =>
            Effect.fail(
              new ComputerHostError({
                code: "timeout",
                message: `${name} did not finish within ${Math.round(timeoutMs / 1000)}s.`,
              }),
            ),
        }),
        Effect.flatMap((raw) =>
          Schema.decodeUnknownEffect(CuaToolResult)(raw).pipe(
            Effect.mapError(
              () =>
                new ComputerHostError({
                  code: "protocol",
                  message: `Cua returned an unexpected ${name} result.`,
                }),
            ),
          ),
        ),
      );

    const health = (current: CuaMcpClient) =>
      Effect.gen(function* () {
        const [permissionsResult, healthResult] = yield* Effect.all(
          [
            request(current, "check_permissions", {}, HEALTH_TIMEOUT_MS),
            request(current, "health_report", {}, HEALTH_TIMEOUT_MS),
          ],
          { concurrency: 2 },
        );
        const permissions = Schema.decodeUnknownOption(CuaPermissions)(
          permissionsResult.structuredContent,
        );
        const report = Schema.decodeUnknownOption(CuaHealth)(healthResult.structuredContent);
        return {
          permissions: Option.match(permissions, {
            onNone: () => ({ accessibility: false, screenRecording: false }),
            onSome: (value) => ({
              accessibility: value.accessibility,
              screenRecording: value.screen_recording,
            }),
          }),
          healthProblems: Option.match(report, {
            onNone: () => ["Cua health_report returned an unexpected shape."],
            onSome: (value) =>
              value.checks
                .filter((check) => check.status !== "pass" && check.status !== "skip")
                .map((check) => `${check.name}: ${check.message}`),
          }),
        };
      });

    // Lives as long as its generation is current: the next notification interrupts it, and the
    // finalizer stops the proxy.
    const runGeneration = (connection: ComputerConnection) =>
      Effect.gen(function* () {
        if (connection.state === "unavailable") {
          yield* Effect.logInfo("cua driver unavailable", {
            reason: connection.reason,
            message: connection.message,
          });
          yield* SubscriptionRef.set(status, unavailable(connection.reason, connection.message));
          return;
        }
        const session = Effect.scoped(
          Effect.gen(function* () {
            const opened = yield* Effect.acquireRelease(
              Effect.tryPromise({
                try: () => openCuaMcpClient(connection.mcp),
                catch: toHostError,
              }),
              (proxy) => Effect.promise(() => proxy.close().catch(() => undefined)),
            );
            // A failed health probe still leaves a usable driver; it is reported, not fatal.
            const report = yield* health(opened).pipe(
              Effect.catch((error) =>
                Effect.succeed({
                  permissions: { accessibility: false, screenRecording: false },
                  healthProblems: [`Health check failed: ${error.message}`],
                }),
              ),
            );
            client = { mcp: opened, sessions: new Map() };
            yield* Effect.logInfo("cua driver connected", {
              generation: connection.generation,
              driverVersion: connection.driverVersion,
              ...report,
            });
            yield* SubscriptionRef.set(status, {
              state: "ready",
              generation: connection.generation,
              driverVersion: connection.driverVersion,
              ...report,
            });
            yield* Effect.promise(() => opened.exited);
            return yield* new ComputerHostError({
              code: "unavailable",
              message: "The Cua MCP proxy exited.",
            });
          }).pipe(Effect.ensuring(Effect.sync(() => void (client = null)))),
        );
        return yield* session.pipe(
          Effect.tapError((error) =>
            Effect.logWarning("cua mcp proxy failed", { message: error.message }).pipe(
              Effect.andThen(
                SubscriptionRef.set(status, unavailable("proxy_failed", error.message)),
              ),
            ),
          ),
          Effect.retry(RELAUNCH),
        );
      });

    if (desktopHost.configured) {
      const decode = Schema.decodeUnknownOption(ComputerConnection);
      yield* desktopHost.notifications.pipe(
        Stream.filter((notification) => notification.method === COMPUTER_CONNECTION_NOTIFICATION),
        Stream.map((notification) => decode(notification.params)),
        Stream.filter(Option.isSome),
        Stream.map((connection) => connection.value),
        // The desktop re-announces the same generation whenever this server reconnects.
        Stream.changesWith((left, right) => JSON.stringify(left) === JSON.stringify(right)),
        Stream.switchMap((connection) => Stream.fromEffect(runGeneration(connection))),
        Stream.runDrain,
        Effect.forkScoped,
      );
    }

    const notConnected = SubscriptionRef.get(status).pipe(
      Effect.flatMap((value) =>
        Effect.fail(
          new ComputerHostError({
            code: "unavailable",
            message:
              value.state === "unavailable"
                ? value.message
                : "Cua Driver is reconnecting. Retry in a few seconds.",
          }),
        ),
      ),
    );
    const decodeImage = Schema.decodeUnknownEffect(ComputerEncodedImage);
    const decodeUserIdle = Schema.decodeUnknownEffect(ComputerUserIdle);
    const decodeDisplays = Schema.decodeUnknownEffect(ComputerDisplays);
    const endLabel = (mcp: CuaMcpClient, label: string) =>
      request(mcp, "end_session", { session: label }, END_SESSION_TIMEOUT_MS).pipe(Effect.ignore);
    return {
      configured: desktopHost.configured,
      status: SubscriptionRef.changes(status),
      currentStatus: SubscriptionRef.get(status),
      callTool: (name, args, options) => {
        const attempt = (retried: boolean): ReturnType<ComputerHostShape["callTool"]> =>
          Effect.suspend(() => {
            const current = client;
            if (!current) return notConnected;
            const session =
              options.threadId === undefined
                ? {}
                : { session: sessionLabel(current.sessions, options.threadId) };
            return request(current.mcp, name, { ...args, ...session }, options.timeoutMs).pipe(
              Effect.flatMap((result) => {
                // Cua ends idle or stopped sessions; ordinary calls never revive them.
                if (
                  !retried &&
                  options.threadId !== undefined &&
                  result.isError &&
                  SESSION_ENDED.test(resultText(result))
                ) {
                  current.sessions.delete(options.threadId);
                  return attempt(true);
                }
                return Effect.succeed(result);
              }),
            );
          });
        return attempt(false);
      },
      endSession: (threadId) =>
        Effect.suspend(() => {
          const current = client;
          const label = current?.sessions.get(threadId);
          if (!current || !label) return Effect.void;
          current.sessions.delete(threadId);
          return endLabel(current.mcp, label);
        }),
      endAllSessions: Effect.suspend(() => {
        const current = client;
        if (!current) return Effect.void;
        const labels = [...current.sessions.values()];
        current.sessions.clear();
        return Effect.forEach(labels, (label) => endLabel(current.mcp, label), {
          concurrency: "unbounded",
          discard: true,
        });
      }),
      userIdleSeconds: desktopHost
        .request(COMPUTER_USER_IDLE_METHOD, {}, HOST_QUERY_TIMEOUT_MS)
        .pipe(
          Effect.flatMap(decodeUserIdle),
          Effect.map((idle) => idle.idleSeconds),
          Effect.mapError(
            (error) =>
              new ComputerHostError({
                code: "protocol",
                message: `Reading user activity failed: ${error.message}`,
              }),
          ),
        ),
      displays: desktopHost.request(COMPUTER_DISPLAYS_METHOD, {}, HOST_QUERY_TIMEOUT_MS).pipe(
        Effect.flatMap(decodeDisplays),
        Effect.map((value) => value.displays),
        Effect.mapError(
          (error) =>
            new ComputerHostError({
              code: "protocol",
              message: `Reading the display geometry failed: ${error.message}`,
            }),
        ),
      ),
      killSwitch: desktopHost.notifications.pipe(
        Stream.filter((notification) => notification.method === COMPUTER_KILL_SWITCH_NOTIFICATION),
        Stream.map(() => undefined),
      ),
      encodeJpeg: (png) =>
        desktopHost
          .request(
            COMPUTER_ENCODE_JPEG_METHOD,
            { data: png, quality: JPEG_QUALITY },
            ENCODE_TIMEOUT_MS,
          )
          .pipe(
            Effect.flatMap(decodeImage),
            Effect.mapError(
              (error) =>
                new ComputerHostError({
                  code: "protocol",
                  message: `JPEG encoding failed: ${error.message}`,
                }),
            ),
          ),
    } satisfies ComputerHostShape;
  }),
);
