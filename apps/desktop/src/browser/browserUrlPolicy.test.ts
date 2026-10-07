import { describe, expect, it } from "vitest";
import { browserUrlBlockReason } from "./browserUrlPolicy";

const GLADE_PORTS = new Set([3773]);

describe("browser URL policy", () => {
  it.each([
    ["http://localhost:3773/", true],
    ["http://localhost.:3773/", true],
    ["http://app.localhost.:3773/", true],
    ["http://127.1:3773/", true],
    ["http://2130706433:3773/", true],
    ["http://0:3773/", true],
    ["http://[0:0:0:0:0:0:0:1]:3773/", true],
    ["http://[::ffff:127.0.0.1]:3773/", true],
    ["http://[::ffff:7f00:1]:3773/", true],
    ["http://[::ffff:0.0.0.0]:3773/", true],
    ["http://localhost:3000/", false],
    ["http://[::ffff:8.8.8.8]:3773/", false],
    ["https://example.com:3773/", false],
  ])("treats %s as Glade's own server: %s", (url, blocked) => {
    expect(browserUrlBlockReason(url, GLADE_PORTS) !== null).toBe(blocked);
  });
});
