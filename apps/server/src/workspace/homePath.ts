import os from "node:os";
import path from "node:path";

// Paths typed by people, and paths of projects on another machine, use "~" for the home directory
// of the machine that resolves them.
export function expandHomePath(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}
