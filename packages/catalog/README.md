# @glade/catalog

Data that Glade ships and publishes, kept in one place. No code lives here.

- `brands/` holds one artwork file per brand, named `<id>.svg` or `<id>.png`. An id is lowercase
  letters and digits, the same normalization used to match MCP server names.
- `brands.json` describes each file: `monochrome` marks are drawn in the text color, `aliases` are
  other names that resolve to the brand, `badge` artwork fills its tile edge to edge, and
  `coverage` is how much of its canvas a padded glyph covers. Every file needs an entry.
- `mcp-servers.json` is the MCP server catalog source: categories and presets. A preset's `icon`
  names a brand id.
- `signed/mcp-servers.json` is generated. Never edit it.

## Adding or changing an MCP server

1. Check the server live: `none` presets answer `initialize` without credentials, `oauth` presets
   accept Glade's client metadata document or a dynamic client registration with a loopback
   redirect, and `token` presets take a bearer token. Leave out vendors that only admit
   pre-registered OAuth apps.
2. Add its artwork to `brands/` and `brands.json`, then the preset to `mcp-servers.json`.
3. Run `bun scripts/catalog/publish.ts`. It validates the source, embeds each preset's artwork as a
   data URL, bumps the version, signs the result and writes it to `signed/` and to
   `apps/landing/public/catalog/`. `bun run check` fails while the signed copies are out of date.
4. Commit and deploy the landing site. Apps fetch `https://useglade.dev/catalog/mcp-servers.json`
   daily and use it once its version is higher than the one they bundle.

## Signing key

Signing uses an Ed25519 key that never enters the repository, read from
`GLADE_CATALOG_SIGNING_KEY` or `~/.config/glade/catalog-signing-key.pem`. Back it up. Its public
half and key id are in `apps/server/src/mcpCatalog/catalogEnvelope.ts`. To rotate, add the new
public key there under a new id, ship a release, then sign with the new key.

The app trusts only the signature, so the hosting path can change without weakening it. A catalog
never auto-connects anything; it only changes what Settings offers.
