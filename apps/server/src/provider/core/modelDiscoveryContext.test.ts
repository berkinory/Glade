import { DEFAULT_SERVER_SETTINGS } from "@glade/contracts/settings/settings";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { expect, it } from "vitest";
import { modelDiscoveryContext } from "./modelDiscoveryContext";

it("keeps native usage-cache rewrites separate from an actual account change", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "glade-model-identity-"));
  try {
    const configFile = path.join(homeDir, ".claude.json");
    const writeAccount = (accountUuid: string, profileFetchedAt: number, usage: number) =>
      writeFile(
        configFile,
        JSON.stringify({
          oauthAccount: { accountUuid, organizationUuid: "org", profileFetchedAt },
          cachedUsageUtilization: usage,
        }),
      );
    const context = () =>
      Effect.runPromise(
        modelDiscoveryContext({
          request: { provider: "claudeAgent", binaryPath: process.execPath },
          settings: DEFAULT_SERVER_SETTINGS,
          homeDir,
        }),
      );
    await writeAccount("account-a", 1, 1);
    const initial = await context();
    await writeAccount("account-a", 2000, 2000);
    expect((await context()).identity).toBe(initial.identity);
    await writeAccount("account-b", 2000, 2000);
    expect((await context()).identity).not.toBe(initial.identity);
    await writeFile(configFile, JSON.stringify(["secret-auth-value"]));
    await expect(context()).rejects.toMatchObject({
      cause: { message: "Malformed provider authentication metadata." },
    });
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
