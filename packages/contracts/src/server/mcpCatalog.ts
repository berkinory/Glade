import { Schema } from "effect";

export const McpConnectorAuthKind = Schema.Literals(["none", "oauth", "token"]);
export type McpConnectorAuthKind = typeof McpConnectorAuthKind.Type;

export const McpCatalogCategory = Schema.Struct({ id: Schema.String, label: Schema.String });
export type McpCatalogCategory = typeof McpCatalogCategory.Type;

export const McpCatalogIcon = Schema.Struct({
  // A data URL, so the signature covers the artwork and showing it fetches nothing.
  src: Schema.String.check(Schema.isStartsWith("data:image/")),
  monochrome: Schema.optionalKey(Schema.Boolean),
  // The artwork carries its own background and fills the tile edge to edge.
  badge: Schema.optionalKey(Schema.Boolean),
  // How much of its canvas a padded glyph covers, so it is enlarged to match the others.
  coverage: Schema.optionalKey(Schema.Number.check(Schema.isBetween({ minimum: 0.1, maximum: 1 }))),
});
export type McpCatalogIcon = typeof McpCatalogIcon.Type;

// "none" servers answer without credentials, "oauth" servers accept Glade's client metadata
// document or a dynamic client registration, and "token" servers take a bearer token.
export const McpConnectorPreset = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  url: Schema.String.check(Schema.isStartsWith("https://")),
  homepage: Schema.String.check(Schema.isStartsWith("https://")),
  category: Schema.String,
  auth: McpConnectorAuthKind,
  // Where the user creates a token: required for "token" presets; on "none" presets it marks an
  // optional key the server accepts, typically for higher limits.
  tokenUrl: Schema.optionalKey(Schema.String.check(Schema.isStartsWith("https://"))),
  icon: Schema.optionalKey(McpCatalogIcon),
});
export type McpConnectorPreset = typeof McpConnectorPreset.Type;

export const McpCatalog = Schema.Struct({
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  categories: Schema.Array(McpCatalogCategory),
  presets: Schema.Array(McpConnectorPreset),
});
export type McpCatalog = typeof McpCatalog.Type;

// What useglade.dev publishes and the app bundles. `payload` is the catalog's JSON text exactly as
// signed, so verification never depends on re-serializing it.
export const McpCatalogEnvelope = Schema.Struct({
  format: Schema.Literal(1),
  keyId: Schema.String,
  payload: Schema.String,
  signature: Schema.String,
});
export type McpCatalogEnvelope = typeof McpCatalogEnvelope.Type;
