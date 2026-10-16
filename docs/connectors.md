# Connectors

Connectors let every agent use remote MCP servers such as Supabase, Linear, Notion or GitHub.
Connect a service once in **Settings → Connectors**; agents in new chats get its tools, whichever
provider runs the chat.

## What happens when you connect

| Step     | What Glade does                                                                                                                                                                                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Probe    | Sends an MCP `initialize` to the server. A valid answer connects it as is; a 401 starts a sign-in. A website, login page or JSON-RPC error is never saved as a server.                                                                                |
| Sign-in  | Uses the MCP SDK's OAuth client: protected-resource and authorization-server discovery, dynamic client registration, PKCE (S256), a single-use `state` and the RFC 8707 `resource`. The browser opens the vendor's page.                              |
| Callback | The vendor redirects to `GET /oauth/mcp/callback` on this machine's loopback port. Requests from other devices are refused. The `state` expires after ten minutes and is the only authority, because the browser carries no Glade session.            |
| Storage  | Connectors and their tokens are one entry (`mcp-connectors`) in the server's secret store, a `0600` file under the Glade home. Entries a build cannot read are written back untouched, and an unreadable store is never overwritten.                  |
| Sessions | Each new provider session gets one MCP server per connector, named `<name>_connector`, pointing at `/mcp/connectors/<id>` on the agent gateway and authenticated with that session's gateway bearer. Running sessions keep the set they started with. |
| Calls    | The gateway checks the bearer and the session's grant, attaches the vendor credential and streams the exchange through the origin-pinned outbound client. A 401 triggers one refresh and one retry.                                                   |

Providers never see vendor tokens. A session can reach only the connectors it was granted when it
started, and its access ends when the session's bearer is revoked.

Responses stream through as they arrive, including SSE, so progress notifications and requests the
server sends during a tool call reach the provider. `GET` opens the server's notification stream
on a separate, smaller admission gate so open streams never queue tool calls.

Refresh tokens may be single-use, so concurrent calls share one refresh. Only `invalid_grant`,
`invalid_client` and `unauthorized_client` mark a connector as signed out; rate limits and server
errors keep the sign-in. Disconnecting deletes the tokens locally first, then attempts RFC 7009
revocation when the server advertises it.

## Providers

Claude receives connectors as SDK `mcpServers` HTTP entries, Codex in each thread's `mcp_servers`
config, and Cursor, Grok and OpenCode through ACP `session/new` when the agent advertises HTTP MCP
support. Each tool call follows the chat's normal approval flow.

## Servers in your agents

Settings → Connectors also lists the MCP servers agents load from their own user configuration,
merged by name with the agents that have each one:

| Agent    | Read from                                                                    | Removed with                      |
| -------- | ---------------------------------------------------------------------------- | --------------------------------- |
| Codex    | the app-server's `mcpServerStatus/list`, with tools and sign-in state        | `codex mcp remove`, then a reload |
| Claude   | the user scope of `.claude.json` (next to `CLAUDE_CONFIG_DIR`, else in home) | `claude mcp remove -s user`       |
| OpenCode | `mcp.servers` (or the version 1 `mcp`) in its global config files            | editing the config file           |
| Cursor   | `mcpServers` in `~/.cursor/mcp.json`                                         | editing the config file           |
| Grok     | `mcp_servers` in `config.toml` under `GROK_HOME`                             | `grok mcp remove -s user`         |

Codex starts its servers to list them, so results are cached until **Check again**; the others are
read from config without connecting. Project-scoped servers, claude.ai connectors, plugin servers
and the servers Grok imports from Claude and Cursor are not listed separately. Glade's own `glade`
and `*_connector` servers are left out.

A server that matches a catalog preset by origin or name offers **Use in Glade**. Once that service
connects, Glade offers to remove the agents' own entries; a server also connected in Glade offers
**Remove from agents** for the same reason, because agents would otherwise load both. Removal needs
confirmation and the `access:write` scope. Glade rewrites a JSON config only when it holds plain
JSON, so a file with comments is left for the user to edit.

## Catalog

The presets live in `packages/shared/src/mcpConnectors/catalog.ts`. Each one was checked against
its live server on 2026-10-16:

- **No sign-in**: the server answers `initialize` without credentials.
- **OAuth**: the server accepted a dynamic client registration with Glade's loopback redirect and
  returned an authorization URL. A full sign-in needs a real account and was tested only for some.
- **Token**: the server takes a bearer token the user creates (GitHub, Render).

Vendors whose live check failed are left out: Figma, Slack, Asana, HubSpot, Box and Dropbox admit
only pre-registered apps, RevenueCat and Calendly refused the registration, and Gamma and IFTTT
reject loopback redirects. Their URLs still work as
custom servers when they accept a token.

Custom servers must be public `https://` endpoints without credentials in the URL.

## Client ID Metadata Document

Glade's OAuth client identity is `https://useglade.dev/oauth/client.json`, served from
`apps/landing/public/oauth/client.json`. A vendor that supports Client ID Metadata Documents fetches
it instead of registering a client. The URL must never change: vendors bind grants to it.

Glade presents the document whenever a server advertises
`client_id_metadata_document_supported`, and registers a client only when it does not. The
document lists portless loopback redirects while the callback carries a per-launch port; OAuth 2.1
has servers accept any port for loopback redirects. A full Linear sign-in confirmed this on
2026-10-16, and ElevenLabs, Eachlabs and MongoDB Atlas accept the document up to their sign-in
page. ElevenLabs and MongoDB Atlas offer no registration, so they work only through the document.

Serving it:

- Deploy the root `docker-compose.yml` on Coolify. It builds
  `infrastructure/docker/landing.Dockerfile` and serves the site on port 4001; set the service's
  domain to `https://useglade.dev` with that port. The container publishes no host port.
- `https://useglade.dev/oauth/client.json` must answer `200` with `Content-Type: application/json`
  directly: no redirects (apex only, no trailing slash, no `http` hop).
- Behind Cloudflare, exempt `/oauth/*` from Bot Fight Mode, challenges and other bot protection.
  Vendors' servers fetch it, not browsers.

## Limits

- Managing connectors is owner-only (`access:write`), because the OAuth redirect targets this
  machine's browser. Paired devices cannot add or remove them.
- Servers without metadata document support get a fresh client registration on every sign-in,
  because the callback URL carries the server's current port. Refreshing tokens does not depend on
  the port.
- Connectors belong to this machine's server. Chats that run on an SSH host do not receive them.
