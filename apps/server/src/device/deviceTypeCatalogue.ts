import * as path from "node:path";

import type { DeviceFamily, DeviceGeometry } from "@glade/contracts";

import type { runProcess } from "../processRunner.ts";

interface DeviceTypeProfile {
  readonly family: DeviceFamily;
  readonly geometry: DeviceGeometry;
}

export type DeviceTypeCatalogue = ReadonlyMap<string, DeviceTypeProfile>;

// Anything unrecognised (a watch, a TV) yields null and is drawn from the device name, because
// guessing "phone" for an Apple TV is worse than the name heuristic.
function familyFor(productFamily: unknown): DeviceFamily | null {
  switch (String(productFamily)) {
    case "iPhone":
    case "iPod touch":
      return "phone";
    case "iPad":
      return "tablet";
    default:
      return null;
  }
}

interface SimctlDeviceType {
  readonly identifier?: unknown;
  readonly productFamily?: unknown;
  readonly bundlePath?: unknown;
}

interface ParsedDeviceType {
  readonly identifier: string;
  readonly family: DeviceFamily;
  readonly profilePath: string;
}

function parseSimctlDeviceTypes(json: string): readonly ParsedDeviceType[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const list = (parsed as { devicetypes?: unknown }).devicetypes;
  if (!Array.isArray(list)) return [];

  const entries: ParsedDeviceType[] = [];
  for (const raw of list as readonly SimctlDeviceType[]) {
    const identifier = typeof raw.identifier === "string" ? raw.identifier : null;
    const bundlePath = typeof raw.bundlePath === "string" ? raw.bundlePath : null;
    const family = familyFor(raw.productFamily);
    if (!identifier || !bundlePath || family === null) continue;
    entries.push({
      identifier,
      family,
      profilePath: path.join(bundlePath, "Contents", "Resources", "profile.plist"),
    });
  }
  return entries;
}

// The plist reports the screen in pixels plus a scale; the contract carries points, because that is
// the unit input is injected in. A profile missing any of the three (or reporting nonsense) yields
// null, so a device keeps whatever the helper later measures rather than inheriting a bad guess.
function parseDeviceTypeProfile(json: string): DeviceGeometry | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const profile = parsed as Record<string, unknown>;
  const read = (key: string): number | null => {
    const value = profile[key];
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
  };
  const pixelWidth = read("mainScreenWidth");
  const pixelHeight = read("mainScreenHeight");
  const scale = read("mainScreenScale");
  if (pixelWidth === null || pixelHeight === null || scale === null) return null;
  return {
    pointWidth: Math.round(pixelWidth / scale),
    pointHeight: Math.round(pixelHeight / scale),
    scale,
  };
}

// Costs one `simctl list devicetypes` plus a `plutil` per type — around 120 short-lived processes
// on a full Xcode — so the caller caches it for the process lifetime. Any single failure is skipped
// rather than failing the whole catalogue: one unreadable profile must not cost the geometry of the
// other 120.
export async function readDeviceTypeCatalogue(input: {
  readonly run: typeof runProcess;
  readonly env?: NodeJS.ProcessEnv | undefined;
}): Promise<DeviceTypeCatalogue> {
  const listing = await input
    .run("xcrun", ["simctl", "list", "devicetypes", "--json"], {
      timeoutMs: 30_000,
      allowNonZeroExit: true,
      outputMode: "truncate",
      env: input.env,
    })
    .catch(() => null);
  if (!listing || listing.code !== 0) return new Map();

  const entries = parseSimctlDeviceTypes(listing.stdout);
  const catalogue = new Map<string, DeviceTypeProfile>();
  await Promise.all(
    entries.map(async (entry) => {
      const result = await input
        .run("plutil", ["-convert", "json", "-o", "-", entry.profilePath], {
          timeoutMs: 10_000,
          allowNonZeroExit: true,
        })
        .catch(() => null);
      if (!result || result.code !== 0) return;
      const geometry = parseDeviceTypeProfile(result.stdout);
      if (!geometry) return;
      catalogue.set(entry.identifier, { family: entry.family, geometry });
    }),
  );
  return catalogue;
}
