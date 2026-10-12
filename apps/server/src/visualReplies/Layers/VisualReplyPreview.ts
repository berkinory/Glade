import type { Browser as PreviewBrowser } from "puppeteer-core";
import { VISUAL_REPLY_MEASURE_WIDTHS } from "@glade/shared/attachments/visualReplyLayout";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { Effect, Layer, Semaphore } from "effect";
import { resolveWindowsSystemRoot } from "@glade/shared/platform/platformEnvironment";
import {
  visualReplyThemeForAppearance,
  visualReplyDocument,
} from "@glade/shared/attachments/visualReplyDocument";
import { lazyModule } from "../../platform/lazyModule.ts";
import { publicPreviewProxy } from "../publicPreviewProxy";
import { ServerConfig } from "../../server/config";
import { VisualReplyError } from "../visualReplySource";
import { VisualReplyPreview, type VisualReplyPreviewShape } from "../Services/VisualReplyPreview";

// Chrome headless shell pinned to puppeteer-core 25.12.0, independent of installed user browsers.
const CHROME_BUILD = "154.0.8037.57";

const loadBrowserInstaller = lazyModule(() => import("@puppeteer/browsers"));
const loadPuppeteer = lazyModule(() => import("puppeteer-core").then((module) => module.default));

const loadPreviewRuntime = <M>(load: () => Promise<M>) =>
  Effect.tryPromise({
    try: load,
    catch: (cause) =>
      new VisualReplyError({
        message: `Could not load the preview browser runtime: ${String(cause)}`,
      }),
  });

export const VisualReplyPreviewLive = Layer.effect(
  VisualReplyPreview,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const admission = Semaphore.makeUnsafe(1);
    const cacheDir = path.join(config.stateDir, "tools", "visual-replies");
    const browserInstall = Effect.map(
      loadPreviewRuntime(loadBrowserInstaller),
      ({ Browser, computeExecutablePath, install }) => {
        const target = { cacheDir, browser: Browser.CHROMEHEADLESSSHELL, buildId: CHROME_BUILD };
        return { executablePath: computeExecutablePath(target), install: () => install(target) };
      },
    );
    const launch = Effect.gen(function* () {
      const puppeteer = yield* loadPreviewRuntime(loadPuppeteer);
      const { executablePath } = yield* browserInstall;
      const proxyPort = yield* publicPreviewProxy;
      const browser = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () =>
            puppeteer.launch({
              executablePath,
              headless: "shell",
              pipe: true,
              handleSIGINT: false,
              handleSIGTERM: false,
              handleSIGHUP: false,
              timeout: 30_000,
              env: {
                PATH: process.env.PATH ?? "",
                ...(process.platform === "win32" ? { SystemRoot: resolveWindowsSystemRoot() } : {}),
              },
              args: [
                `--proxy-server=socks5://127.0.0.1:${proxyPort}`,
                "--proxy-bypass-list=<-loopback>",
                "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
                "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
                "--disable-background-networking",
                "--disable-component-update",
                "--disable-quic",
              ],
            }),
          catch: (cause) =>
            new VisualReplyError({
              message: `Could not start sandboxed preview browser: ${String(cause)}`,
            }),
        }),
        (browser) => Effect.promise(() => browser.close()),
      );
      return browser;
    });
    const render = async (
      browser: PreviewBrowser,
      html: string,
      width: number,
      appearance: "light" | "dark",
    ) => {
      const context = await browser.createBrowserContext({ downloadBehavior: { policy: "deny" } });
      const page = await context.newPage();
      await page.setViewport({ width, height: 800 });
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
          html,
          channel: randomUUID(),
          theme: {
            ...visualReplyThemeForAppearance(appearance),
            background: appearance === "light" ? "#fcfcfc" : "#0e0e0e",
            fontFamily: '"Liberation Sans", Arimo, Arial, Helvetica, sans-serif',
          },
        }),
        { waitUntil: "load", timeout: 10_000 },
      );
      await page.evaluate(
        "document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))",
      );
      return { page, context, consoleLines };
    };
    const measureExpression =
      "(() => { const root = document.documentElement; return Math.max(0, Math.ceil(root.scrollHeight > root.clientHeight ? root.scrollHeight : root.getBoundingClientRect().height)); })()";
    const capture: VisualReplyPreviewShape["capture"] = (input) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { executablePath, install } = yield* browserInstall;
          if (!existsSync(executablePath)) {
            yield* Effect.logInfo("Installing the visual reply preview browser", {
              buildId: CHROME_BUILD,
            });
            yield* Effect.tryPromise({
              try: install,
              catch: (cause) =>
                new VisualReplyError({
                  message: `Preview browser installation failed: ${String(cause)}`,
                }),
            });
          }
          const browser = yield* launch;
          return yield* Effect.tryPromise({
            try: async () => {
              const { page, consoleLines } = await render(
                browser,
                input.html,
                input.width,
                input.appearance ?? "dark",
              );
              const contentHeight = Number(await page.evaluate(measureExpression));
              const png = await page.screenshot({
                type: "png",
                clip: {
                  x: 0,
                  y: 0,
                  width: input.width,
                  height: Math.max(1, Math.min(input.height, contentHeight)),
                },
              });
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
    const measure: VisualReplyPreviewShape["measure"] = (html) =>
      Effect.gen(function* () {
        const { executablePath } = yield* browserInstall;
        if (!existsSync(executablePath)) return undefined;
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const browser = yield* launch;
            return yield* Effect.tryPromise({
              try: async () => {
                const heights: (readonly [number, number])[] = [];
                for (let index = 0; index < VISUAL_REPLY_MEASURE_WIDTHS.length; index += 3) {
                  const batch = await Promise.all(
                    VISUAL_REPLY_MEASURE_WIDTHS.slice(index, index + 3).map(async (width) => {
                      const { page, context } = await render(browser, html, width, "dark");
                      try {
                        return [width, Number(await page.evaluate(measureExpression))] as const;
                      } finally {
                        await context.close();
                      }
                    }),
                  );
                  heights.push(...batch);
                }
                return heights;
              },
              catch: (cause) =>
                new VisualReplyError({ message: `Height measurement failed: ${String(cause)}` }),
            });
          }),
        ).pipe(
          Effect.timeoutOrElse({
            duration: "6 seconds",
            onTimeout: () =>
              Effect.fail(
                new VisualReplyError({
                  message: "Height measurement exceeded its 6-second budget.",
                }),
              ),
          }),
          admission.withPermit,
        );
      }).pipe(Effect.catch((error) => Effect.logWarning(error.message).pipe(Effect.as(undefined))));
    return { capture, measure };
  }),
);
