export type SpinnerVariant = "action" | "loading" | "working" | "terminal" | "voice";

// Adapted from zzzzshawn/matrix's Mobius Run, Prism Sweep, Core Spiral,
// Flux Columns and Sound Bars. See LICENSE.dotmatrix.txt in this directory.
const PERIMETER_PATH = [0, 1, 2, 3, 4, 9, 14, 19, 24, 23, 22, 21, 20, 15, 10, 5];
const TWIST_INNER = [6, 8, 18, 16];
const SPIRAL_ORDER = [
  0, 1, 2, 3, 4, 15, 16, 17, 18, 5, 14, 23, 24, 19, 6, 13, 22, 21, 20, 7, 12, 11, 10, 9, 8,
];
const DIAGONAL_ORDER = [
  0, 1, 5, 6, 14, 2, 4, 7, 13, 15, 3, 8, 12, 16, 21, 9, 11, 17, 20, 22, 10, 18, 19, 23, 24,
];

function pathOpacity(age: number): number {
  return [1, 0.644, 0.442, 0.24][age] ?? 0.16;
}

function opacity(variant: SpinnerVariant, index: number, step: number, steps: number): number {
  const row = Math.floor(index / 5);
  const col = index % 5;
  switch (variant) {
    case "action": {
      const onLoop = PERIMETER_PATH.indexOf(index);
      let brightness = 0.08;
      if (onLoop >= 0) {
        const forward = (step - onLoop + steps) % steps;
        const back = (step + steps / 2 - onLoop + steps) % steps;
        brightness = Math.max(
          brightness,
          [1, 0.82, 0.64, 0.46, 0.3, 0.18][forward] ?? 0,
          [0.38, 0.3, 0.22, 0.14][back] ?? 0,
        );
      }
      if (step % 4 === 0) {
        if (TWIST_INNER[step / 4] === index) brightness = Math.max(brightness, 0.52);
        if (index === 12) brightness = Math.max(brightness, 0.55);
      }
      return brightness;
    }
    case "loading": {
      const age = (step - (DIAGONAL_ORDER[index] ?? 0) + steps) % steps;
      return pathOpacity(age);
    }
    case "working": {
      const age = (step - (SPIRAL_ORDER[index] ?? 0) + steps) % steps;
      return pathOpacity(age);
    }
    case "terminal": {
      const position = col % 2 === 0 ? 4 - row : row;
      const age = (step - position + steps) % steps;
      return [0.704, 0.492, 0.256, 0.192, 0.1][age] ?? 0.16;
    }
    case "voice": {
      // Two complete waves make the last-to-first transition match every other frame.
      const phase = (step / steps) * 4 * Math.PI + col * 1.15;
      const level = Math.max(1, Math.min(5, Math.round(1 + ((Math.sin(phase) + 1) / 2) * 4)));
      return row === 5 - level ? 1 : row > 5 - level ? 0.94 : 0.08;
    }
  }
}

function profile(variant: SpinnerVariant, duration: number, steps: number) {
  return {
    duration,
    // The repeated endpoint occupies no interval; each real frame gets exactly 1 / steps.
    keyTimes: Array.from({ length: steps + 1 }, (_, step) => step / steps).join(";"),
    dots: Array.from({ length: 25 }, (_, index) => {
      const values = Array.from({ length: steps }, (_, step) =>
        opacity(variant, index, step, steps),
      );
      return {
        index,
        still: values[Math.floor(steps / 4)] ?? 0.16,
        values: [...values, values[0]].join(";"),
      };
    }),
  };
}

export const DOT_MATRIX_PROFILES = {
  action: profile("action", 1.6 / 1.45, 16),
  loading: profile("loading", 1.5 / 1.35, 25),
  working: profile("working", 1.5 / 1.35, 25),
  terminal: profile("terminal", 1.5 / 2.2, 5),
  voice: profile("voice", 1.75 / 1.35, 48),
};
