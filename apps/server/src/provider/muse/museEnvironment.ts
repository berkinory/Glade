import { buildProviderChildEnvironment } from "../core/providerChildEnvironment.ts";

// An API key in META_API_KEY takes priority over the account login.
export const MUSE_CREDENTIAL_GRANTS: ReadonlySet<string> = new Set(["META_API_KEY"]);

// The `muse` launcher otherwise checks for updates on every start and may fork a background download
// that Glade's process-tree teardown would cut short.
export const museChildEnvironment = () =>
  buildProviderChildEnvironment({
    credentialGrants: MUSE_CREDENTIAL_GRANTS,
    overrides: { MUSE_NO_AUTO_UPDATE: "1" },
  });
