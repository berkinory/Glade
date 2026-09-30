import { describe, expect, it, vi } from "vitest";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCodexProcessEnv } from "../codexProcessEnv";
import { CodexAppServerManager } from "../codexAppServerManager";

describe("Codex Glade harness policy", () => {
  it("resolves the gateway endpoint when each session environment is built", async () => {
    const homePath = mkdtempSync(path.join(os.tmpdir(), "glade-codex-gateway-endpoint-"));
    const previousGladeHome = process.env.GLADE_HOME;
    process.env.GLADE_HOME = path.join(homePath, "glade-home");
    let endpointUrl = "http://127.0.0.1:0/mcp";
    try {
      const manager = new CodexAppServerManager(undefined, {
        agentGatewayMcp: {
          endpointUrl: () => endpointUrl,
          acquireSessionLease: () => ({
            connection: { url: endpointUrl, bearerToken: "token" },
            cancelTurn: () => Promise.resolve(),
            retireTurn: () => Promise.resolve(),
            release: () => undefined,
          }),
        },
      });
      endpointUrl = "http://127.0.0.1:48123/mcp";
      const env = await (
        manager as unknown as {
          buildSessionProcessEnv: (
            homePath: string | undefined,
            token: string | undefined,
          ) => Promise<NodeJS.ProcessEnv>;
        }
      ).buildSessionProcessEnv(homePath, "token");
      const configPath = path.join(env.CODEX_HOME ?? homePath, "config.toml");
      expect(readFileSync(configPath, "utf8")).toContain('url = "http://127.0.0.1:48123/mcp"');
    } finally {
      if (previousGladeHome === undefined) {
        delete process.env.GLADE_HOME;
      } else {
        process.env.GLADE_HOME = previousGladeHome;
      }
      rmSync(homePath, { recursive: true, force: true });
    }
  });
});

describe("buildCodexProcessEnv", () => {
  it("hydrates the active custom provider env_key from the effective CODEX_HOME", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "glade-codex-env-"));
    try {
      writeFileSync(
        path.join(tempDir, "config.toml"),
        [
          'model_provider = "my-company-proxy"',
          "",
          '[model_providers."my-company-proxy"]',
          'env_key = "MY_COMPANY_PROXY_KEY"',
        ].join("\n"),
        "utf8",
      );

      const readEnvironment = vi.fn(() => ({
        PATH: "/opt/homebrew/bin:/usr/bin",
        SSH_AUTH_SOCK: "/tmp/ssh.sock",
        MY_COMPANY_PROXY_KEY: "proxy-secret",
      }));

      const env = await buildCodexProcessEnv({
        env: {
          GLADE_HOME: path.join(tempDir, "glade-home"),
          SHELL: "/bin/zsh",
          PATH: "/usr/bin",
        },
        homePath: tempDir,
        platform: "darwin",
        readEnvironment,
      });

      expect(readEnvironment).toHaveBeenCalledWith("/bin/zsh", [
        "PATH",
        "SSH_AUTH_SOCK",
        "MY_COMPANY_PROXY_KEY",
      ]);
      expect(env.CODEX_HOME).toContain("codex-home-overlay");
      expect(env.MY_COMPANY_PROXY_KEY).toBe("proxy-secret");
      expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps the private desktop browser host out of the Codex process", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "glade-codex-private-host-"));
    const codexHome = path.join(tempDir, "codex-home");
    mkdirSync(codexHome, { recursive: true });
    try {
      const env = await buildCodexProcessEnv({
        env: {
          CODEX_HOME: codexHome,
          GLADE_HOME: tempDir,
          GLADE_BROWSER_HOST_PIPE_PATH: "/tmp/glade-browser-host.sock",
          GLADE_BROWSER_USE_PIPE_PATH: "/tmp/legacy-browser-use.sock",
          GLADE_BROWSER_HOST_CAPABILITY: "desktop-capability",
          GLADE_BROWSER_HOST_CAPABILITY_FD: "3",
          NODE_REPL_SANDBOX_ALLOWED_UNIX_SOCKETS: "/tmp/existing.sock",
        },
        platform: "darwin",
      });

      expect(env.GLADE_BROWSER_HOST_PIPE_PATH).toBeUndefined();
      expect(env.GLADE_BROWSER_USE_PIPE_PATH).toBeUndefined();
      expect(env.GLADE_BROWSER_HOST_CAPABILITY).toBeUndefined();
      expect(env.GLADE_BROWSER_HOST_CAPABILITY_FD).toBeUndefined();
      expect(env.NODE_REPL_SANDBOX_ALLOWED_UNIX_SOCKETS).toBeUndefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps Codex SQLite state out of Glade's Codex home overlay", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "glade-codex-env-"));
    const runtimeHome = mkdtempSync(path.join(os.tmpdir(), "glade-runtime-home-"));
    const lstatOrUndefined = (target: string) => {
      try {
        return lstatSync(target);
      } catch {
        return undefined;
      }
    };
    try {
      writeFileSync(path.join(tempDir, "config.toml"), 'model = "gpt-5.5"', "utf8");
      writeFileSync(path.join(tempDir, "history.jsonl"), "", "utf8");
      const sourceSqliteEntries = [
        "state_5.sqlite",
        "state_5.sqlite-wal",
        "state_5.sqlite-shm",
        "memories_1.sqlite",
      ];
      for (const entry of sourceSqliteEntries) {
        writeFileSync(path.join(tempDir, entry), "source-db", "utf8");
      }

      const overlayHome = path.join(runtimeHome, "codex-home-overlay");
      mkdirSync(overlayHome, { recursive: true });

      const legacyLinks = ["state_5.sqlite", "thread_history_1.sqlite-wal"];
      for (const entry of legacyLinks) {
        symlinkSync(path.join(tempDir, entry), path.join(overlayHome, entry), "file");
      }
      const staleOverlayDbPath = path.join(overlayHome, "memories_1.sqlite");
      writeFileSync(staleOverlayDbPath, "stale-overlay-db", "utf8");

      const env = await buildCodexProcessEnv({
        env: { GLADE_HOME: runtimeHome },
        homePath: tempDir,
        platform: "darwin",
      });

      expect(env.CODEX_HOME).toBe(overlayHome);
      expect(env.CODEX_SQLITE_HOME).toBe(tempDir);
      for (const entry of [...sourceSqliteEntries, ...legacyLinks]) {
        if (entry === "memories_1.sqlite") continue;
        expect(lstatOrUndefined(path.join(overlayHome, entry))).toBeUndefined();
      }

      expect(lstatSync(staleOverlayDbPath).isSymbolicLink()).toBe(false);
      expect(readFileSync(staleOverlayDbPath, "utf8")).toBe("stale-overlay-db");
      const overlayHistoryPath = path.join(overlayHome, "history.jsonl");
      expect(lstatSync(overlayHistoryPath).isSymbolicLink()).toBe(true);
      expect(readlinkSync(overlayHistoryPath)).toBe(path.join(tempDir, "history.jsonl"));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
      rmSync(runtimeHome, { recursive: true, force: true });
    }
  });

  it("repairs stale auth.json files in Glade's Codex home overlay", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "glade-codex-env-"));
    const runtimeHome = mkdtempSync(path.join(os.tmpdir(), "glade-runtime-home-"));
    try {
      const sourceAuthPath = path.join(tempDir, "auth.json");
      writeFileSync(path.join(tempDir, "config.toml"), 'model = "gpt-5.5"', "utf8");
      writeFileSync(sourceAuthPath, '{"tokens":{"access_token":"fresh"}}', "utf8");

      const overlayHome = path.join(runtimeHome, "codex-home-overlay");
      const overlayAuthPath = path.join(overlayHome, "auth.json");
      mkdirSync(overlayHome, { recursive: true });
      writeFileSync(overlayAuthPath, '{"tokens":{"access_token":"stale"}}', "utf8");

      const env = await buildCodexProcessEnv({
        env: { GLADE_HOME: runtimeHome },
        homePath: tempDir,
        platform: "darwin",
      });

      expect(env.CODEX_HOME).toBe(overlayHome);
      expect(lstatSync(overlayAuthPath).isSymbolicLink()).toBe(true);
      expect(readlinkSync(overlayAuthPath)).toBe(sourceAuthPath);
      expect(readFileSync(overlayAuthPath, "utf8")).toContain("fresh");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
      rmSync(runtimeHome, { recursive: true, force: true });
    }
  });
});
