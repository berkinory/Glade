import { describe, expect, it } from "vitest";
import { browserUrlBlockReason, type BrowserRequestKind } from "./browserUrlPolicy";

const GLADE_PORTS = new Set([3773]);

describe("browser URL policy", () => {
  it.each<[string, BrowserRequestKind, boolean]>([
    ["http://localhost:3773/", "resource", true],
    ["http://localhost.:3773/", "resource", true],
    ["http://app.localhost.:3773/", "resource", true],
    ["http://127.1:3773/", "resource", true],
    ["http://2130706433:3773/", "resource", true],
    ["http://0:3773/", "resource", true],
    ["http://[0:0:0:0:0:0:0:1]:3773/", "resource", true],
    ["http://[::ffff:127.0.0.1]:3773/", "resource", true],
    ["http://[::ffff:7f00:1]:3773/", "resource", true],
    ["http://[::ffff:0.0.0.0]:3773/", "resource", true],
    ["http://localhost:3000/", "page", false],
    ["http://192.168.1.20:8080/", "page", false],
    ["http://10.0.0.5/", "page", false],
    ["http://[::ffff:8.8.8.8]:3773/", "resource", false],
    ["https://example.com:3773/", "page", false],
    ["http://169.254.169.254/latest/meta-data/", "resource", true],
    ["http://169.254.1.1/", "page", true],
    ["http://[::ffff:169.254.169.254]/", "resource", true],
    ["http://[::ffff:a9fe:a9fe]/", "resource", true],
    ["http://0xa9fea9fe/", "resource", true],
    ["http://[fe80::1]/", "resource", true],
    ["http://[febf::1]/", "page", true],
    ["http://[fec0::1]/", "page", false],
    ["http://metadata.google.internal/computeMetadata/v1/", "resource", true],
    ["http://METADATA.GOOGLE.INTERNAL./", "page", true],
    ["http://metadata/", "page", true],
    ["http://100.100.100.200/latest/meta-data/", "resource", true],
    ["http://[fd00:ec2::254]/", "resource", true],
    ["file:///etc/passwd", "page", true],
    ["file:///etc/passwd", "resource", true],
    ["data:text/html,hi", "page", true],
    ["data:text/html,hi", "frame", false],
    ["data:image/png;base64,AA", "resource", false],
    ["javascript:alert(1)", "page", true],
    ["chrome://settings", "frame", true],
    ["ftp://example.com/", "page", true],
    ["about:blank", "page", false],
  ])("%s as %s is blocked: %s", (url, kind, blocked) => {
    expect(browserUrlBlockReason(url, GLADE_PORTS, kind) !== null).toBe(blocked);
  });
});
