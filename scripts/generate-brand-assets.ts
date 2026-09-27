// Regenerate platform exports from the same vector used by the application.
// Requires ImageMagick and Xcode 26 on macOS; no network access is used.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { GLADE_MARK_QUADRANT, GLADE_MARK_ROTATIONS } from "../apps/web/src/assets/gladeMark.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "glade-brand-"));
const paths = GLADE_MARK_ROTATIONS.map(
  (angle) => `<path d="${GLADE_MARK_QUADRANT}" transform="rotate(${angle} 512 512)"/>`,
).join("");
const tile =
  "M300 100H724C858 100 924 166 924 300V724C924 858 858 924 724 924H300C166 924 100 858 100 724V300C100 166 166 100 300 100Z";

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} failed: ${result.error?.message || result.stderr || result.stdout}`,
    );
  }
}

function write(relative: string, content: string) {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function copy(source: string, target: string) {
  mkdirSync(dirname(join(root, target)), { recursive: true });
  copyFileSync(join(root, source), join(root, target));
}

function svg(content: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="1024" viewBox="0 0 1024 1024">${content}</svg>`;
}

function mark(fill: string, size = 600) {
  const inset = (1024 - size) / 2;
  return `<g transform="translate(${inset} ${inset}) scale(${size / 1024})" fill="${fill}">${paths}</g>`;
}

function render(content: string, target: string, size = 1024) {
  mkdirSync(dirname(join(root, target)), { recursive: true });
  const image = new Resvg(content, {
    fitTo: { mode: "width", value: size },
    font: { loadSystemFonts: false },
  }).render();
  writeFileSync(join(root, target), image.asPng());
}

function ico(source: string, target: string, sizes = "256,128,64,48,32,16") {
  run("magick", [join(root, source), "-define", `icon:auto-resize=${sizes}`, join(root, target)]);
}

function icns(source: string, target: string) {
  const iconset = join(scratch, "Glade.iconset");
  mkdirSync(iconset, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      run("magick", [
        join(root, source),
        "-resize",
        `${size * scale}x${size * scale}`,
        join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`),
      ]);
    }
  }
  run("iconutil", ["-c", "icns", iconset, "-o", join(root, target)]);
}

try {
  const gradients = `<defs><linearGradient id="light" x2="0" y2="1"><stop stop-color="#ffffff"/><stop offset="1" stop-color="#e9ebef"/></linearGradient><linearGradient id="dark" x2="0" y2="1"><stop stop-color="#34383e"/><stop offset="1" stop-color="#111316"/></linearGradient><linearGradient id="silver" x2="0" y2="1"><stop stop-color="#ffffff"/><stop offset="1" stop-color="#dce0e7"/></linearGradient><clipPath id="tile"><path d="${tile}"/></clipPath></defs>`;
  const light = svg(
    `${gradients}<path d="${tile}" fill="url(#light)" stroke="#d8dbe0" stroke-width="2"/>${mark("#111318")}`,
  );
  const dark = svg(
    `${gradients}<path d="${tile}" fill="url(#dark)" stroke="#484c53" stroke-width="2"/>${mark("url(#silver)")}`,
  );
  const blueprintBackground = readFileSync(
    join(root, "assets/dev/Glade.icon/Assets/background.png"),
  ).toString("base64");
  const dev = svg(
    `${gradients}<g clip-path="url(#tile)"><image width="1024" height="1024" xlink:href="data:image/png;base64,${blueprintBackground}"/></g><path d="${tile}" fill="none" stroke="#2069bb" stroke-width="2"/>${mark("url(#silver)")}`,
  );

  write("assets/brand/glade.svg", `${svg(`<g fill="#000">${paths}</g>`)}\n`);
  write(
    "apps/web/public/glade-logo.svg",
    `${svg(`<style>path{fill:#1c2933}@media(prefers-color-scheme:dark){path{fill:#f5f5f5}}</style>${paths}`)}\n`,
  );
  render(svg(mark("#000", 736)), "assets/brand/glade-master.png", 2048);
  render(svg(mark("#000")), "assets/prod/Glade.icon/Assets/glyph.png");
  render(svg(`${gradients}${mark("url(#silver)")}`), "assets/dev/Glade.icon/Assets/glyph.png");

  for (const filename of [
    "black-macos-1024.png",
    "black-macos-legacy-1024.png",
    "black-universal-1024.png",
  ]) {
    render(light, `assets/prod/${filename}`);
  }
  for (const filename of ["blueprint-macos-1024.png", "blueprint-universal-1024.png"]) {
    render(dev, `assets/dev/${filename}`);
  }
  for (const [variant, prefix, content] of [
    ["prod", "glade-black", light],
    ["dev", "blueprint", dev],
  ] as const) {
    for (const size of [16, 32])
      render(content, `assets/${variant}/${prefix}-web-favicon-${size}x${size}.png`, size);
    render(content, `assets/${variant}/${prefix}-web-apple-touch-180.png`, 180);
    const source = `assets/${variant}/${variant === "prod" ? "black" : "blueprint"}-universal-1024.png`;
    ico(source, `assets/${variant}/${prefix}-web-favicon.ico`, "48,32,16");
    ico(source, `assets/${variant}/${prefix}-windows.ico`);
  }

  for (const filename of [
    "app-icon-linux.png",
    "app-icon-macos.png",
    "dock-icon.png",
    "icon.png",
    "glade.png",
  ]) {
    copy("assets/prod/black-macos-legacy-1024.png", `apps/desktop/resources/${filename}`);
  }
  render(dark, "apps/desktop/resources/dock-icon-dark.png");
  copy("assets/prod/black-universal-1024.png", "apps/web/public/glade.png");
  for (const filename of ["icon.ico", "app-icon-windows.ico"]) {
    copy("assets/prod/glade-black-windows.ico", `apps/desktop/resources/${filename}`);
  }
  for (const [name, content] of [
    ["default", light],
    ["icon-group-600-macos", light],
    ["dark", dark],
  ] as const) {
    render(content, `apps/web/public/app-icons/${name}.png`, 256);
  }
  for (const [source, target] of [
    ["glade-black-web-favicon.ico", "favicon.ico"],
    ["glade-black-web-favicon-16x16.png", "favicon-16x16.png"],
    ["glade-black-web-favicon-32x32.png", "favicon-32x32.png"],
    ["glade-black-web-apple-touch-180.png", "apple-touch-icon.png"],
  ])
    copy(`assets/prod/${source}`, `apps/web/public/${target}`);

  icns("assets/prod/black-macos-legacy-1024.png", "apps/desktop/resources/icon.icns");
  icns("assets/dev/blueprint-macos-1024.png", "assets/dev/blueprint-macos.icns");
  run("xcrun", [
    "actool",
    "assets/prod/Glade.icon",
    "--compile",
    scratch,
    "--platform",
    "macosx",
    "--minimum-deployment-target",
    "26.0",
    "--app-icon",
    "Glade",
    "--include-all-app-icons",
    "--output-partial-info-plist",
    join(scratch, "partial.plist"),
  ]);
  copyFileSync(join(scratch, "Assets.car"), join(root, "assets/prod/Glade-Assets.car"));
  console.log("Updated Glade vector, platform icons, favicons, and macOS icon catalog.");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
