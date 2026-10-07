import type * as CuaSdk from "@trycua/cua-driver";
import type * as CuaElectron from "@trycua/cua-driver/electron";
import { createRequire } from "node:module";
import * as FS from "node:fs";
import * as Path from "node:path";
import { pathToFileURL } from "node:url";

const PACKAGE = Path.join("@trycua", "cua-driver");

// The SDK is ESM only and exports no `require` entry, so it is imported by file URL. It hands
// dlopen a native library path computed from its own location; inside app.asar that path is not a
// real file, so packaged builds import the unpacked copy that electron-builder leaves beside it.
function packageDist(): string {
  const searchPaths = createRequire(__filename).resolve.paths(PACKAGE) ?? [];
  const root = searchPaths
    .map((directory) => Path.join(directory, PACKAGE))
    .find((candidate) => FS.existsSync(Path.join(candidate, "package.json")));
  if (!root) throw new Error("The @trycua/cua-driver package is not installed.");
  return Path.join(root.replace(/app\.asar(?=[\\/])/u, "app.asar.unpacked"), "dist");
}

const load = <Module>(entry: string): Promise<Module> =>
  import(pathToFileURL(Path.join(packageDist(), entry)).href) as Promise<Module>;

let sdk: Promise<typeof CuaSdk> | null = null;
let electron: Promise<typeof CuaElectron> | null = null;

export const loadCuaSdk = () => (sdk ??= load<typeof CuaSdk>("index.js"));
export const loadCuaElectron = () => (electron ??= load<typeof CuaElectron>("electron.js"));
