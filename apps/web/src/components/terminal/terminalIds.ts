import { randomUUID } from "~/lib/utils";

export function randomTerminalId(): string {
  return `terminal-${randomUUID()}`;
}
