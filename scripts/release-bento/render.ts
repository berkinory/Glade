// Renders a release's bento overview to the WebP image the app and the GitHub release show. Usage: node scripts/release-bento/render.ts X.Y.Z
// The layout and copy come from releases/X.Y.Z.ts; the counts come from CHANGELOG.md.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Browser, computeExecutablePath, install } from "@puppeteer/browsers";
import puppeteer from "puppeteer-core";
import type { ReleaseBento, ReleaseCounts } from "./kit.ts";

// The headless shell build pinned to puppeteer-core 25.12.0, as in the server's visual replies.
const CHROME_BUILD = "154.0.8037.57";
const WIDTH = 1600;
const HEIGHT = 1000;
// AVIF at this quality is about 60% of the size of WebP with no visible loss on UI text.
const AVIF_QUALITY = 60;

const root = resolve(import.meta.dirname, "../..");
const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error("Usage: node scripts/release-bento/render.ts X.Y.Z");
}

// Visuals are made before a release, so an unreleased version counts the Unreleased section.
function releaseCounts(): ReleaseCounts {
  const lines = readFileSync(join(root, "CHANGELOG.md"), "utf8").split(/\r?\n/);
  let start = lines.findIndex((line) => line.startsWith(`## ${version} `));
  if (start < 0) start = lines.findIndex((line) => line === "## Unreleased");
  if (start < 0)
    throw new Error(`CHANGELOG.md has neither a ${version} nor an Unreleased section.`);
  console.log(`Counting entries under "${lines[start]}".`);
  const counts = { New: 0, Improved: 0, Fixed: 0 };
  let category: string | null = null;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    if (line.startsWith("### ")) category = line.slice(4).trim();
    else if (line.startsWith("- ") && category && category in counts) {
      counts[category as keyof ReleaseCounts] += 1;
    }
  }
  return counts;
}

function page(bento: ReleaseBento, counts: ReleaseCounts): string {
  const mono = readFileSync(
    createRequire(import.meta.url).resolve(
      "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
    ),
  ).toString("base64");
  const css = readFileSync(join(import.meta.dirname, "bento.css"), "utf8").replace(
    "MONO_FONT",
    `data:font/woff2;base64,${mono}`,
  );
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}${bento.css}</style></head><body><main class="grid">${bento.render({ version: version!, counts })}</main></body></html>`;
}

const { default: bento } = (await import(`./releases/${version}.ts`)) as { default: ReleaseBento };
const counts = releaseCounts();
const cacheDir = join(root, "scripts/node_modules/.cache/release-bento");
await install({ cacheDir, browser: Browser.CHROMEHEADLESSSHELL, buildId: CHROME_BUILD });
const scratch = mkdtempSync(join(tmpdir(), "glade-release-bento-"));
const browser = await puppeteer.launch({
  executablePath: computeExecutablePath({
    cacheDir,
    browser: Browser.CHROMEHEADLESSSHELL,
    buildId: CHROME_BUILD,
  }),
  headless: "shell",
});
try {
  const outDir = join(root, "apps/web/src/whatsNew/releases");
  mkdirSync(outDir, { recursive: true });
  const tab = await browser.newPage();
  await tab.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });
  await tab.setContent(page(bento, counts), { waitUntil: "load" });
  await tab.evaluate("document.fonts.ready.then(() => true)");
  const png = join(scratch, "bento.png") as `${string}.png`;
  await tab.screenshot({ path: png, type: "png" });
  const avif = join(outDir, `${version}.avif`);
  const result = spawnSync("magick", [png, "-quality", String(AVIF_QUALITY), avif], {
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    throw new Error(`magick failed: ${result.error?.message ?? result.stderr}`);
  }
  console.log(`Wrote ${avif}`);
} finally {
  await browser.close();
  rmSync(scratch, { recursive: true, force: true });
}
