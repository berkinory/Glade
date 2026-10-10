import { encode } from "uqr";

const stdout = process.stdout;
const color = stdout.isTTY === true && !process.env.NO_COLOR && process.env.TERM !== "dumb";

const paint = (code: string) => (text: string) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
export const bold = paint("1");
export const dim = paint("2");
export const green = paint("32");
export const red = paint("31");
export const yellow = paint("33");
export const accent = paint("36");

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function line(text = ""): void {
  stdout.write(`  ${text}\n`);
}

export function header(version: string): void {
  stdout.write("\n");
  line(`${accent("◆")} ${bold("glade")} ${dim(version)}`);
  stdout.write("\n");
}

// One spinner on one line, drawn in this process: no helper process, and plain lines when output is
// not a terminal (logs, CI, a pipe).
export async function step<T>(label: string, run: () => Promise<T>, done?: (value: T) => string) {
  if (!color) {
    line(`${label}…`);
    const value = await run();
    line(`✓ ${done ? done(value) : label}`);
    return value;
  }
  let frame = 0;
  stdout.write("\x1b[?25l");
  const draw = () =>
    stdout.write(`\r\x1b[2K  ${accent(FRAMES[frame++ % FRAMES.length]!)} ${label}…`);
  draw();
  const timer = setInterval(draw, 80);
  try {
    const value = await run();
    stdout.write(`\r\x1b[2K  ${green("✓")} ${done ? done(value) : label}\n`);
    return value;
  } catch (error) {
    stdout.write(`\r\x1b[2K  ${red("✗")} ${label}\n`);
    throw error;
  } finally {
    clearInterval(timer);
    stdout.write("\x1b[?25h");
  }
}

// Updates one line in place, for countdowns. Returns a function that ends it.
export function liveLine(): { update: (text: string) => void; end: (text: string) => void } {
  return {
    update: (text) => (color ? stdout.write(`\r\x1b[2K  ${text}`) : undefined),
    end: (text) => stdout.write(`${color ? "\r\x1b[2K" : ""}  ${text}\n`),
  };
}

// Dark modules on an explicit light background, two module rows per text row. The colors are fixed
// 256-color white and black rather than theme colors, so the code scans the same in every theme.
export function qrCode(data: string): string {
  const modules = encode(data, { border: 2 }).data;
  const rows: string[] = [];
  for (let y = 0; y < modules.length; y += 2) {
    let row = "";
    for (let x = 0; x < modules[y]!.length; x += 1) {
      const top = modules[y]![x];
      const bottom = modules[y + 1]?.[x] ?? false;
      row += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
    }
    rows.push(color ? `  \x1b[38;5;16;48;5;231m${row}\x1b[0m` : `  ${row}`);
  }
  return rows.join("\n");
}

process.once("exit", () => {
  if (color) stdout.write("\x1b[?25h");
});
