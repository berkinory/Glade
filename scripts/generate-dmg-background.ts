import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const background = readFileSync(join(root, "assets/brand/artwork/dmg.png")).toString("base64");
const artwork = `<svg xmlns="http://www.w3.org/2000/svg" width="642" height="406" viewBox="0 0 642 406">
  <image width="642" height="406" href="data:image/png;base64,${background}" preserveAspectRatio="xMidYMid slice"/>
  <path d="M267 116C327 120 381 150 418 190M401 185L418 190L416 173" fill="none" stroke="#f5ecde" stroke-opacity="0.78" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="321" y="355" text-anchor="middle" font-family="Helvetica Neue" font-size="18" font-weight="500" fill="#f5ecde">Drag Glade to Applications</text>
</svg>`;

// dmg-builder combines the 1x and @2x siblings into a Retina TIFF automatically.
for (const scale of [1, 2]) {
  const filename = `dmg-background${scale === 2 ? "@2x" : ""}.png`;
  const image = new Resvg(artwork, { fitTo: { mode: "width", value: 642 * scale } }).render();
  writeFileSync(join(root, "apps/desktop/resources/dmgly/assets", filename), image.asPng());
}
console.log("Updated 1x and Retina DMG backgrounds.");
