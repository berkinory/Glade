import { install, Browser, computeExecutablePath } from "@puppeteer/browsers";
import puppeteer from "puppeteer-core";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import path from "node:path";
import { Effect, Layer, Semaphore } from "effect";
import { resolveWindowsSystemRoot } from "@glade/shared/platform/platformEnvironment";
import {
  DEFAULT_VISUAL_REPLY_THEME,
  visualReplyDocument,
} from "@glade/shared/attachments/visualReplyDocument";
import { ServerConfig } from "../../server/config";
import { VisualReplyError } from "../visualReplySource";
import { VisualReplyPreview, type VisualReplyPreviewShape } from "../Services/VisualReplyPreview";

// Chrome for Testing pinned to puppeteer-core 25.12.0, independent of installed user browsers.
const CHROME_BUILD = "154.0.8037.57";

export const VisualReplyPreviewLive = Layer.effect(
  VisualReplyPreview,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const admission = Semaphore.makeUnsafe(1);
    const cacheDir = path.join(config.stateDir, "tools", "visual-replies");
    const executablePath = computeExecutablePath({
      cacheDir,
      browser: Browser.CHROME,
      buildId: CHROME_BUILD,
    });
    const capture: VisualReplyPreviewShape["capture"] = (input) =>
      Effect.scoped(
        Effect.gen(function* () {
          if (!existsSync(executablePath)) {
            yield* Effect.logInfo("Installing the visual reply preview browser", {
              buildId: CHROME_BUILD,
            });
            yield* Effect.tryPromise({
              try: () => install({ cacheDir, browser: Browser.CHROME, buildId: CHROME_BUILD }),
              catch: (cause) =>
                new VisualReplyError({
                  message: `Preview browser installation failed: ${String(cause)}`,
                }),
            });
          }
          // CDP request interception does not cover WebSockets, prefetch or service workers. The
          // mandatory dead-end proxy blocks those too, including Chromium's implicit loopback bypass.
          const proxy = yield* Effect.acquireRelease(
            Effect.tryPromise({
              try: () =>
                new Promise<ReturnType<typeof createServer>>((resolve, reject) => {
                  const server = createServer((socket) => {
                    socket.destroy();
                  });
                  server.once("error", reject);
                  server.listen(0, "127.0.0.1", () => {
                    resolve(server);
                  });
                }),
              catch: (cause) =>
                new VisualReplyError({ message: `Preview isolation failed: ${String(cause)}` }),
            }),
            (server) =>
              Effect.promise(
                () =>
                  new Promise<void>((resolve) => {
                    server.close(() => {
                      resolve();
                    });
                  }),
              ),
          );
          const address = proxy.address();
          if (!address || typeof address === "string")
            return yield* new VisualReplyError({
              message: "Preview proxy did not acquire a port.",
            });
          const browser = yield* Effect.acquireRelease(
            Effect.tryPromise({
              try: () =>
                puppeteer.launch({
                  executablePath,
                  headless: true,
                  pipe: true,
                  handleSIGINT: false,
                  handleSIGTERM: false,
                  handleSIGHUP: false,
                  timeout: 30_000,
                  env: {
                    PATH: process.env.PATH ?? "",
                    ...(process.platform === "win32"
                      ? { SystemRoot: resolveWindowsSystemRoot() }
                      : {}),
                  },
                  args: [
                    `--proxy-server=http://127.0.0.1:${address.port}`,
                    "--proxy-bypass-list=<-loopback>",
                    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
                    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
                    "--disable-background-networking",
                    "--disable-component-update",
                  ],
                }),
              catch: (cause) =>
                new VisualReplyError({
                  message: `Could not start sandboxed preview browser: ${String(cause)}`,
                }),
            }),
            (browser) => Effect.promise(() => browser.close()),
          );
          return yield* Effect.tryPromise({
            try: async () => {
              const context = await browser.createBrowserContext({
                downloadBehavior: { policy: "deny" },
              });
              const page = await context.newPage();
              await page.setViewport({ width: input.width, height: input.height });
              await page.setRequestInterception(true);
              page.on("request", (request) => {
                const action = request.url().startsWith("data:")
                  ? request.continue()
                  : request.abort();
                void action.catch(() => undefined);
              });
              page.on("dialog", (dialog) => {
                void dialog.dismiss().catch(() => undefined);
              });
              const consoleLines: string[] = [];
              const record = (message: string) => {
                if (consoleLines.length < 30) consoleLines.push(message.slice(0, 1000));
              };
              page.on("console", (message) => {
                record(message.text());
              });
              page.on("pageerror", (error) => {
                record(String(error));
              });
              await page.setContent(
                visualReplyDocument({
                  html: input.html,
                  channel: randomUUID(),
                  theme: DEFAULT_VISUAL_REPLY_THEME,
                }),
                { waitUntil: "domcontentloaded", timeout: 10_000 },
              );
              await page.evaluate("document.fonts.ready");
              const contentHeight = Number(
                await page.evaluate(
                  "Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)",
                ),
              );
              const png = await page.screenshot({ type: "png" });
              return { png, contentHeight, console: consoleLines };
            },
            catch: (cause) => new VisualReplyError({ message: `Preview failed: ${String(cause)}` }),
          }).pipe(
            Effect.timeoutOrElse({
              duration: "20 seconds",
              onTimeout: () =>
                Effect.fail(
                  new VisualReplyError({
                    message: "Preview exceeded its 20-second rendering budget.",
                  }),
                ),
            }),
          );
        }),
      ).pipe(admission.withPermit);
    return { capture };
  }),
);
