import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { AuthPairingLinkRepositoryError } from "../Errors";

export const AuthPairingLinkRecord = Schema.Struct({
  id: Schema.String,
  method: Schema.Literals(["desktop-bootstrap", "one-time-token"]),
  role: Schema.Literals(["owner", "client"]),
  subject: Schema.String,
  label: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
  consumedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  revokedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
export type AuthPairingLinkRecord = typeof AuthPairingLinkRecord.Type;

export const CreateAuthPairingLinkInput = Schema.Struct({
  id: Schema.String,
  credentialHash: Schema.String,
  method: Schema.Literals(["desktop-bootstrap", "one-time-token"]),
  role: Schema.Literals(["owner", "client"]),
  subject: Schema.String,
  label: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
});
export type CreateAuthPairingLinkInput = typeof CreateAuthPairingLinkInput.Type;

export const ConsumeAuthPairingLinkInput = Schema.Struct({
  credentialHash: Schema.String,
  consumedAt: Schema.DateTimeUtcFromString,
  now: Schema.DateTimeUtcFromString,
});
export type ConsumeAuthPairingLinkInput = typeof ConsumeAuthPairingLinkInput.Type;

export const ListActiveAuthPairingLinksInput = Schema.Struct({
  now: Schema.DateTimeUtcFromString,
});
export type ListActiveAuthPairingLinksInput = typeof ListActiveAuthPairingLinksInput.Type;

export const RevokeAuthPairingLinkInput = Schema.Struct({
  id: Schema.String,
  revokedAt: Schema.DateTimeUtcFromString,
});
export type RevokeAuthPairingLinkInput = typeof RevokeAuthPairingLinkInput.Type;

export const GetAuthPairingLinkByCredentialHashInput = Schema.Struct({
  credentialHash: Schema.String,
});
export type GetAuthPairingLinkByCredentialHashInput =
  typeof GetAuthPairingLinkByCredentialHashInput.Type;

export interface AuthPairingLinkRepositoryShape {
  readonly create: (
    input: CreateAuthPairingLinkInput,
  ) => Effect.Effect<void, AuthPairingLinkRepositoryError>;
  readonly consumeAvailable: (
    input: ConsumeAuthPairingLinkInput,
  ) => Effect.Effect<Option.Option<AuthPairingLinkRecord>, AuthPairingLinkRepositoryError>;
  readonly listActive: (
    input: ListActiveAuthPairingLinksInput,
  ) => Effect.Effect<ReadonlyArray<AuthPairingLinkRecord>, AuthPairingLinkRepositoryError>;
  readonly revoke: (
    input: RevokeAuthPairingLinkInput,
  ) => Effect.Effect<boolean, AuthPairingLinkRepositoryError>;
  readonly getByCredentialHash: (
    input: GetAuthPairingLinkByCredentialHashInput,
  ) => Effect.Effect<Option.Option<AuthPairingLinkRecord>, AuthPairingLinkRepositoryError>;
}

export class AuthPairingLinkRepository extends ServiceMap.Service<
  AuthPairingLinkRepository,
  AuthPairingLinkRepositoryShape
>()("glade/persistence/Services/AuthPairingLinks/AuthPairingLinkRepository") {}
