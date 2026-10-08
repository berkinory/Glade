import { describe, expect, it } from "vitest";

import { redactSensitiveProcessArgs } from "./processArgumentRedaction";

const redactProcessTableArgs = (args: string) =>
  redactSensitiveProcessArgs(args, { truncateSensitiveEnvironmentRemainder: true });

describe("redactSensitiveProcessArgs", () => {
  it("redacts sensitive flag values in both supported forms", () => {
    expect(redactSensitiveProcessArgs("tool --api-key secret --token=other --verbose")).toBe(
      "tool --api-key [redacted] --token=[redacted] --verbose",
    );
  });

  it("redacts bearer and OpenAI-style secret tokens", () => {
    expect(redactSensitiveProcessArgs("Bearer abc.def sk-abcdefgh1234 keep-me")).toBe(
      "Bearer [redacted] [redacted] keep-me",
    );
  });

  it("redacts external MCP pairing codes and credentials from process diagnostics", () => {
    expect(
      redactSensitiveProcessArgs(
        "glade mcp pair --code syn_pair_v1_short-lived syn_mcp_v1_client-secret",
      ),
    ).toBe("glade mcp pair --code [redacted] [redacted]");
  });

  it.each([
    "AWS_SECRET_ACCESS_KEY",
    "PRIVATE_KEY",
    "SECRET_KEY",
    "AWS_SESSION_TOKEN",
    "JWT_SIGNING_KEY",
    "ENCRYPTION_KEY",
    "MASTER_KEY",
    "AUTH",
    "CREDENTIAL",
    "DB_PASS",
    "PASSWORD",
    "TOKEN",
  ])("redacts the common secret environment name %s", (name) => {
    expect(redactProcessTableArgs(`env ${name}=secret bun run dev`)).toBe(`env ${name}=[redacted]`);
  });

  it.each([
    'PASSWORD="correct horse"battery',
    "DB_PASSWORD=correct\\ horse\\ battery",
    "TOKEN=prefix'middle'suffix",
    "DB_PASSWORD=$(printf supersecret)",
    "DB_PASSWORD=`printf supersecret`",
  ])("redacts the complete shell-composed assignment value %s", (assignment) => {
    const name = assignment.slice(0, assignment.indexOf("="));
    expect(redactProcessTableArgs(`env ${assignment} bun run dev`)).toBe(`env ${name}=[redacted]`);
  });

  it("fails closed when process-table output loses a spaced secret's argv boundary", () => {
    expect(redactProcessTableArgs("docker run -e APP_PASSWORD=correct horse image --verbose")).toBe(
      "docker run -e APP_PASSWORD=[redacted]",
    );
  });

  it.each([";", "&&", "||", "("])(
    "recognizes sensitive assignments after the flattened shell separator %s",
    (separator) => {
      expect(redactProcessTableArgs(`/bin/sh -c echo ready${separator}PASSWORD=secret app`)).toBe(
        `/bin/sh -c echo ready${separator}PASSWORD=[redacted]`,
      );
    },
  );

  it.each(["'", '"'])("recognizes sensitive assignments quoted with %s", (quote) => {
    expect(redactProcessTableArgs(`sh -c env ${quote}PASSWORD=secret${quote} sleep 30`)).toBe(
      `sh -c env ${quote}PASSWORD=[redacted]`,
    );
  });

  it.each([
    ["'PASSWORD=correct horse' remains useful", "'PASSWORD=[redacted]' remains useful"],
    ['PASSWORD=$(printf x "$(printf y)")supersecret remains useful', "PASSWORD=[redacted]"],
    ['"PASSWORD=$(printf x "$(printf y)")supersecret" remains useful', '"PASSWORD=[redacted]'],
    ["PASSWORD=${UNSET:-correct horse}suffix remains useful", "PASSWORD=[redacted] remains useful"],
    ["PASSWORD=$((1 + (2 * 3)))supersecret remains useful", "PASSWORD=[redacted] remains useful"],
    ["PASSWORD=$[1 + 2]supersecret remains useful", "PASSWORD=[redacted] remains useful"],
    [
      "PASSWORD=$(case x in x) printf supersecret;; esac)suffix remains useful",
      "PASSWORD=[redacted]",
    ],
    [
      "PASSWORD=$(case y in x) printf esac;; y) printf supersecret;; esac)suffix remains useful",
      "PASSWORD=[redacted]",
    ],
    [
      "PASSWORD=$(case case in case) printf supersecret;; esac)suffix remains useful",
      "PASSWORD=[redacted]",
    ],
    [
      "PASSWORD=$(case 1 in 1) printf supersecret;; esac)suffix remains useful",
      "PASSWORD=[redacted]",
    ],
    [
      "PASSWORD=$(case \\x in x) printf supersecret;; esac)suffix remains useful",
      "PASSWORD=[redacted]",
    ],
    [
      "PASSWORD=$(case y in x) printf noop;; # esac\ny) printf supersecret;; esac)suffix remains useful",
      "PASSWORD=[redacted]",
    ],
    [
      "PASSWORD=$(printf noop\ncase y in y) printf supersecret;; esac\n)suffix remains useful",
      "PASSWORD=[redacted]",
    ],
    [
      "PASSWORD=$(if true; then case y in y) printf supersecret;; esac; fi)suffix remains useful",
      "PASSWORD=[redacted]",
    ],
    [
      "PASSWORD=$(time case y in y) printf supersecret;; esac)suffix remains useful",
      "PASSWORD=[redacted]",
    ],
    [
      "PASSWORD=$(case y in\nx) cat <<EOF\n;;\nesac\nEOF\n;;\ny) printf supersecret;;\nesac\n)suffix remains useful",
      "PASSWORD=[redacted]",
    ],
    ["PASSWORD=$(printf case)supersecret remains useful", "PASSWORD=[redacted]"],
    ["PASSWORD=$(printf [)supersecret remains useful", "PASSWORD=[redacted]"],
    [
      "PASSWORD=$(</dev/null case x in x) printf supersecret;; esac)suffix remains useful",
      "PASSWORD=[redacted]",
    ],
  ])("redacts the complete nested bounded assignment value in %j", (args, expected) => {
    expect(redactSensitiveProcessArgs(args)).toBe(expected);
  });

  it("fails closed for adjacent shell segments after an externally quoted assignment", () => {
    expect(redactSensitiveProcessArgs(`env 'PASSWORD=prefix'"correct horse" app --verbose`)).toBe(
      `env 'PASSWORD=[redacted]`,
    );
  });

  it("fails closed once nested assignment syntax exceeds the scan bound", () => {
    const nested = "(".repeat(512) + "secret" + ")".repeat(512);
    expect(redactSensitiveProcessArgs(`PASSWORD=$(${nested}) remains useful`)).toBe(
      "PASSWORD=[redacted]",
    );
  });

  it.each([
    ["PASSWORD=<(printf supersecret) remains useful", "PASSWORD=[redacted]"],
    ["PASSWORD=>(cat supersecret) remains useful", "PASSWORD=[redacted]"],
    ["'PASSWORD=prefix'<(printf supersecret) remains useful", "'PASSWORD=[redacted]"],
    ["PASSWORD=(correct horse) remains useful", "PASSWORD=[redacted]"],
  ])("fails closed for process substitution in %j", (args, expected) => {
    expect(redactSensitiveProcessArgs(args)).toBe(expected);
  });

  it("recognizes append-style sensitive assignments", () => {
    expect(redactSensitiveProcessArgs("PASSWORD+=supersecret remains useful")).toBe(
      "PASSWORD+=[redacted] remains useful",
    );
    expect(redactProcessTableArgs("bash -c PASSWORD+=supersecret; sleep 30")).toBe(
      "bash -c PASSWORD+=[redacted]",
    );
  });

  it("recognizes sensitive assignments nested in explicit environment options", () => {
    expect(
      redactSensitiveProcessArgs("systemd-run --setenv=PASSWORD=supersecret sleep infinity"),
    ).toBe("systemd-run --setenv=PASSWORD=[redacted] sleep infinity");
    expect(redactProcessTableArgs("systemd-run --setenv=PASSWORD=supersecret sleep infinity")).toBe(
      "systemd-run --setenv=PASSWORD=[redacted]",
    );
    expect(
      redactSensitiveProcessArgs('systemd-run "--setenv=PASSWORD=supersecret" sleep infinity'),
    ).toBe('systemd-run "--setenv=PASSWORD=[redacted]" sleep infinity');
    expect(redactSensitiveProcessArgs("prefix--setenv=PASSWORD=ordinary remains useful")).toBe(
      "prefix--setenv=PASSWORD=ordinary remains useful",
    );
  });

  it.each(["PGPASSWORD", "MYSQL_PWD", "REDISCLI_AUTH"])(
    "redacts the established database credential environment name %s",
    (name) => {
      expect(redactProcessTableArgs(`env ${name}=supersecret server`)).toBe(
        `env ${name}=[redacted]`,
      );
      expect(redactSensitiveProcessArgs(`${name}=supersecret remains useful`)).toBe(
        `${name}=[redacted] remains useful`,
      );
    },
  );

  it("redacts credential-bearing environment URLs in process tables", () => {
    expect(
      redactProcessTableArgs(
        "env DATABASE_URL=postgres://alice:supersecret@db.example/app bun run dev",
      ),
    ).toBe("env DATABASE_URL=[redacted]");
  });

  it("redacts through the last userinfo marker in credential URLs", () => {
    expect(
      redactSensitiveProcessArgs(
        "connection postgres://alice:p@ss@db.example/app failed without retry",
      ),
    ).toBe("connection postgres://[redacted]@db.example/app failed without retry");
  });

  it.each(["https://example.com?email=alice@example.com", "https://example.com#alice@example.com"])(
    "does not confuse the query or fragment email in %s with URL credentials",
    (url) => {
      expect(redactSensitiveProcessArgs(`open ${url} now`)).toBe(`open ${url} now`);
    },
  );

  it("preserves generic diagnostic context after a bounded assignment value", () => {
    expect(redactSensitiveProcessArgs("Configuration KEY=value is invalid at line 42")).toBe(
      "Configuration KEY=[redacted] is invalid at line 42",
    );
  });

  it("does not redact unrelated environment assignments", () => {
    const args = "env MONKEY=value TURKEY=istanbul NODE_ENV=development bun run dev";
    expect(redactSensitiveProcessArgs(args)).toBe(args);
  });
});
