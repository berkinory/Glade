import type { ComputerDisplays } from "@glade/contracts/computer/computerHost";
import { Effect } from "effect";

import { refuse, type ComputerToolServices } from "./computerCalls.ts";

type Display = ComputerDisplays["displays"][number];

const round = (value: number) => Math.round(value * 100) / 100;

const describe = (display: Display) => {
  const { bounds, workArea } = display;
  const origin =
    bounds.x === 0 && bounds.y === 0 ? "" : ` at x=${round(bounds.x)} y=${round(bounds.y)}`;
  return `${round(bounds.width)}×${round(bounds.height)}${origin} (work area x=${round(workArea.x)} y=${round(workArea.y)} ${round(workArea.width)}×${round(workArea.height)}), scale ${round(display.scaleFactor)}`;
};

// One line of display geometry in the coordinates window bounds use, so an agent can place a
// window without probing the screen size. The primary display comes first.
export const screenLine = (services: ComputerToolServices) =>
  services.host.displays.pipe(
    Effect.catch((error) => refuse("computer_protocol", error.message)),
    Effect.map(([main, ...others]) =>
      !main
        ? "Screen: none reported"
        : others.length === 0
          ? `Screen: ${describe(main)}`
          : `Screens: main ${[main, ...others].map(describe).join("; ")}`,
    ),
  );
