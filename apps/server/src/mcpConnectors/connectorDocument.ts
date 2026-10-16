import { ProviderKind } from "@glade/contracts/core/baseSchemas";
import { Schema } from "effect";

const JsonRecord = Schema.Record(Schema.String, Schema.Unknown);

// OAuth objects are kept as the vendor returned them: the SDK reads extra fields such as
// `token_endpoint_auth_method` back on refresh.
const StoredOAuth = Schema.Struct({
  kind: Schema.Literal("oauth"),
  authorizationServerUrl: Schema.String,
  authorizationServerMetadata: Schema.NullOr(JsonRecord),
  clientInformation: JsonRecord,
  tokens: JsonRecord,
  expiresAt: Schema.NullOr(Schema.Number),
  // RFC 8707 resource indicator chosen at sign-in, sent again on refresh.
  resource: Schema.NullOr(Schema.String),
});
export type StoredOAuth = typeof StoredOAuth.Type;

const StoredAuth = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({ kind: Schema.Literal("token"), token: Schema.String }),
  StoredOAuth,
]);
export type StoredAuth = typeof StoredAuth.Type;

const StoredConnector = Schema.Struct({
  connectorId: Schema.String,
  presetId: Schema.NullOr(Schema.String),
  name: Schema.String,
  url: Schema.String,
  // The MCP server name agents see; fixed at creation so tool names stay stable.
  serverName: Schema.String,
  status: Schema.Literals(["connected", "needs-sign-in"]),
  connectedAt: Schema.String,
  // Missing or null: every agent, including ones added later.
  providers: Schema.optionalKey(Schema.NullOr(Schema.Array(ProviderKind))),
  auth: StoredAuth,
});
export type StoredConnector = typeof StoredConnector.Type;

const DocumentEnvelope = Schema.Struct({
  version: Schema.Literal(1),
  connectors: Schema.Array(Schema.Unknown),
});

export interface ConnectorsDocument {
  readonly connectors: ReadonlyArray<StoredConnector>;
  // Entries this build cannot read. They are written back untouched so a newer build's data, or
  // one damaged entry, never erases itself.
  readonly unreadable: ReadonlyArray<unknown>;
}

export const EMPTY_CONNECTORS_DOCUMENT: ConnectorsDocument = { connectors: [], unreadable: [] };

const decodeEnvelope = Schema.decodeUnknownSync(DocumentEnvelope);
const decodeConnector = Schema.decodeUnknownOption(StoredConnector);

function hasRequiredOAuthFields(connector: StoredConnector): boolean {
  if (connector.auth.kind !== "oauth") return true;
  return (
    typeof connector.auth.clientInformation.client_id === "string" &&
    typeof connector.auth.tokens.access_token === "string"
  );
}

// Throws when the document as a whole is unreadable; the caller must then refuse to save over it.
export function decodeConnectorsDocument(raw: string | null): ConnectorsDocument {
  if (raw === null) return EMPTY_CONNECTORS_DOCUMENT;
  const envelope = decodeEnvelope(JSON.parse(raw));
  const connectors: StoredConnector[] = [];
  const unreadable: unknown[] = [];
  for (const entry of envelope.connectors) {
    const decoded = decodeConnector(entry);
    if (decoded._tag === "Some" && hasRequiredOAuthFields(decoded.value)) {
      connectors.push(decoded.value);
    } else {
      unreadable.push(entry);
    }
  }
  return { connectors, unreadable };
}

export function encodeConnectorsDocument(document: ConnectorsDocument): string {
  return JSON.stringify({
    version: 1,
    connectors: [...document.connectors, ...document.unreadable],
  });
}
