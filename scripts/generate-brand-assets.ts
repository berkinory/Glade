import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { GLADE_MARK_PATH } from "../apps/web/src/assets/gladeMark.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "glade-brand-"));
const paths = `<path d="${GLADE_MARK_PATH}"/>`;
const tile =
  "M300 100H724C858 100 924 166 924 300V724C924 858 858 924 724 924H300C166 924 100 858 100 724V300C100 166 166 100 300 100Z";
const tileSize = 824;
const markSize = 530;
// Icon Composer sources fill the whole canvas, so the mark keeps its proportion of the tile.
const fullBleedMarkSize = (markSize * 1024) / tileSize;
const ink = { light: "#131514", dark: "#f3ead8", dev: "#f4f9fd" } as const;
const paper = { light: "#fbf9f2", dark: "#191614", dev: "#1591fa" } as const;
type Variant = keyof typeof ink;

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
  const output = resolve(root, target);
  mkdirSync(dirname(output), { recursive: true });
  const image = new Resvg(content, {
    fitTo: { mode: "width", value: Math.max(size, 1024) },
    font: { loadSystemFonts: false },
  }).render();
  if (size >= 1024) {
    writeFileSync(output, image.asPng());
    return;
  }
  // The ASCII plates alias into moire when rasterized straight to small sizes; filter a full render instead.
  // Lanczos ringing leaves faint alpha outside the tile, which ICO masks turn into opaque pixels,
  // and slightly translucent pixels just inside it; snap both ends.
  const full = join(scratch, "render.png");
  writeFileSync(full, image.asPng());
  run("magick", [
    full,
    "-filter",
    "Lanczos",
    "-resize",
    `${size}x${size}`,
    "-channel",
    "A",
    "-fx",
    "u<0.02?0:u>0.98?1:u",
    "+channel",
    output,
  ]);
}

function plate(variant: Variant, size: number) {
  const target = join(scratch, `${variant}-${size}.png`);
  run("magick", [
    `assets/brand/artwork/${variant}.png`,
    "-filter",
    "Lanczos",
    "-resize",
    `${size}x${size}`,
    target,
  ]);
  return `data:image/png;base64,${readFileSync(target).toString("base64")}`;
}

function artwork(variant: Variant) {
  return svg(
    `<defs><clipPath id="tile"><path d="${tile}"/></clipPath></defs><g clip-path="url(#tile)"><image x="100" y="100" width="${tileSize}" height="${tileSize}" xlink:href="${plate(variant, tileSize)}"/>${mark(ink[variant], markSize)}</g>`,
  );
}

// At 16px the texture is only noise around the mark, so the smallest frames use a flat tile.
function flatArtwork(variant: Variant) {
  return svg(`<path d="${tile}" fill="${paper[variant]}"/>${mark(ink[variant], markSize)}`);
}

function icon(variant: Variant, target: string, size = 1024) {
  render(size <= 16 ? flatArtwork(variant) : artwork(variant), target, size);
}

function fullBleedPlate(variant: Variant) {
  return `<image width="1024" height="1024" xlink:href="${plate(variant, 1024)}"/>`;
}

function ico(variant: Variant, target: string, sizes = [256, 128, 64, 48, 32, 16]) {
  const frames = sizes.map((size) => {
    const frame = join(scratch, `ico-${size}.png`);
    icon(variant, frame, size);
    return frame;
  });
  run("magick", [...frames, join(root, target)]);
}

function icns(variant: Variant, target: string) {
  const iconset = join(scratch, "Glade.iconset");
  mkdirSync(iconset, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      icon(
        variant,
        join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`),
        size * scale,
      );
    }
  }
  run("iconutil", ["-c", "icns", iconset, "-o", join(root, target)]);
}

try {
  write("assets/brand/glade.svg", `${svg(`<g fill="#000">${paths}</g>`)}\n`);
  write(
    "apps/web/public/glade-logo.svg",
    `${svg(`<style>path{fill:#1c2933}@media(prefers-color-scheme:dark){path{fill:#f5f5f5}}</style>${paths}`)}\n`,
  );
  render(svg(mark("#000", 736)), "assets/brand/glade-master.png", 2048);
  // Icon Composer applies the platform mask itself; keep its sources edge-to-edge.
  render(
    svg(`${fullBleedPlate("light")}${mark(ink.light, fullBleedMarkSize)}`),
    "assets/prod/Glade.icon/Assets/background.png",
  );
  render(svg(fullBleedPlate("dev")), "assets/dev/Glade.icon/Assets/background.png");
  render(svg(mark(ink.dev, fullBleedMarkSize)), "assets/dev/Glade.icon/Assets/glyph.png");

  for (const filename of [
    "black-macos-1024.png",
    "black-macos-legacy-1024.png",
    "black-universal-1024.png",
  ]) {
    icon("light", `assets/prod/${filename}`);
  }
  for (const filename of ["blueprint-macos-1024.png", "blueprint-universal-1024.png"]) {
    icon("dev", `assets/dev/${filename}`);
  }
  for (const [folder, prefix, variant] of [
    ["prod", "glade-black", "light"],
    ["dev", "blueprint", "dev"],
  ] as const) {
    for (const size of [16, 32])
      icon(variant, `assets/${folder}/${prefix}-web-favicon-${size}x${size}.png`, size);
    icon(variant, `assets/${folder}/${prefix}-web-apple-touch-180.png`, 180);
    ico(variant, `assets/${folder}/${prefix}-web-favicon.ico`, [48, 32, 16]);
    ico(variant, `assets/${folder}/${prefix}-windows.ico`);
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
  icon("dark", "apps/desktop/resources/dock-icon-dark.png");
  icon("dark", "apps/desktop/resources/icon-dark.png");
  ico("dark", "apps/desktop/resources/icon-dark.ico");
  copy("assets/prod/black-universal-1024.png", "apps/web/public/glade.png");
  for (const filename of ["icon.ico", "app-icon-windows.ico"]) {
    copy("assets/prod/glade-black-windows.ico", `apps/desktop/resources/${filename}`);
  }
  icon("light", "apps/web/public/app-icons/default.png", 256);
  icon("dark", "apps/web/public/app-icons/dark.png", 256);
  for (const [source, target] of [
    ["glade-black-web-favicon.ico", "favicon.ico"],
    ["glade-black-web-favicon-16x16.png", "favicon-16x16.png"],
    ["glade-black-web-favicon-32x32.png", "favicon-32x32.png"],
    ["glade-black-web-apple-touch-180.png", "apple-touch-icon.png"],
  ])
    copy(`assets/prod/${source}`, `apps/web/public/${target}`);

  icns("light", "apps/desktop/resources/icon.icns");
  icns("dev", "assets/dev/blueprint-macos.icns");
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
