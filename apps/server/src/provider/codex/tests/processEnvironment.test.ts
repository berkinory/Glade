import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCodexProcessEnv } from "../codexProcessEnv";
import { buildCodexAppServerArgs } from "../codexLaunch";

describe("Codex launch environment", () => {
  it("passes the gateway through native config overrides while preserving user shell exclusions", async () => {
    const homePath = mkdtempSync(path.join(os.tmpdir(), "glade-codex-launch-"));
    try {
      writeFileSync(
        path.join(homePath, "config.toml"),
        '[shell_environment_policy]\nexclude = ["AWS_*"]\n',
      );
      const args = await buildCodexAppServerArgs({
        cwd: homePath,
        env: { CODEX_HOME: homePath },
        gatewayEndpointUrl: "http://127.0.0.1:48123/mcp",
      });
      expect(args).toContain(
        'shell_environment_policy.exclude=["AWS_*","GLADE_AGENT_GATEWAY_TOKEN"]',
      );
      expect(args).toContain('mcp_servers.glade={url="http://127.0.0.1:48123/mcp"}');
      expect(args).not.toContain("secret-token");
    } finally {
      rmSync(homePath, { recursive: true, force: true });
    }
  });

  it("hydrates only the active custom provider env_key from the login shell, once per process", async () => {
    const homePath = mkdtempSync(path.join(os.tmpdir(), "glade-codex-env-"));
    try {
      writeFileSync(
        path.join(homePath, "config.toml"),
        [
          'model_provider = "my-company-proxy"',
          "",
          '[model_providers."my-company-proxy"]',
          'env_key = "MY_COMPANY_PROXY_KEY"',
        ].join("\n"),
      );
      const readEnvironment = vi.fn(() => ({ MY_COMPANY_PROXY_KEY: "proxy-secret" }));
      const build = () =>
        buildCodexProcessEnv({
          env: { SHELL: "/bin/zsh", PATH: "/usr/bin" },
          homePath,
          platform: "darwin",
          readEnvironment,
        });
      const env = await build();
      await build();
      expect(readEnvironment).toHaveBeenCalledTimes(1);
      expect(readEnvironment).toHaveBeenCalledWith("/bin/zsh", ["MY_COMPANY_PROXY_KEY"]);
      expect(env.CODEX_HOME).toBe(homePath);
      expect(env.MY_COMPANY_PROXY_KEY).toBe("proxy-secret");
      expect(env.PATH).toBe("/usr/bin");
    } finally {
      rmSync(homePath, { recursive: true, force: true });
    }
  });

  it("keeps the private desktop browser host out of the Codex process", async () => {
    const homePath = mkdtempSync(path.join(os.tmpdir(), "glade-codex-private-host-"));
    try {
      const env = await buildCodexProcessEnv({
        env: {
          CODEX_HOME: homePath,
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
      rmSync(homePath, { recursive: true, force: true });
    }
  });
});
