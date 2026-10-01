import { Schema, SchemaIssue } from "effect";

export class PersistenceSqlError extends Schema.TaggedErrorClass<PersistenceSqlError>()(
  "PersistenceSqlError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `SQL error in ${this.operation}: ${this.detail}`;
  }
}

export class PersistenceDecodeError extends Schema.TaggedErrorClass<PersistenceDecodeError>()(
  "PersistenceDecodeError",
  {
    operation: Schema.String,
    issue: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Decode error in ${this.operation}: ${this.issue}`;
  }
}

export function toPersistenceSqlError(operation: string) {
  return (cause: unknown): PersistenceSqlError => {
    const messages: string[] = [];
    const seen = new Set<unknown>();
    let current: unknown = cause;
    while (current && typeof current === "object" && !seen.has(current)) {
      seen.add(current);
      if (current instanceof Error && current.message && !messages.includes(current.message)) {
        messages.push(current.message);
      }
      current = "cause" in current ? (current as { readonly cause?: unknown }).cause : undefined;
    }
    const causeDetail = messages.length > 0 ? ` (${messages.join(": ")})` : "";
    return new PersistenceSqlError({
      operation,
      detail: `Failed to execute ${operation}${causeDetail}`,
      cause,
    });
  };
}

export function toPersistenceDecodeError(operation: string) {
  return (error: Schema.SchemaError): PersistenceDecodeError =>
    new PersistenceDecodeError({
      operation,
      issue: SchemaIssue.makeFormatterDefault()(error.issue),
      cause: error,
    });
}

export function toPersistenceSqlOrDecodeError(
  sqlOperation: string,
  decodeOperation: string,
): (cause: unknown) => PersistenceSqlError | PersistenceDecodeError {
  return (cause) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

export class ProjectionStateIncompleteError extends Schema.TaggedErrorClass<ProjectionStateIncompleteError>()(
  "ProjectionStateIncompleteError",
  {
    missingProjectors: Schema.Array(Schema.String),
    knownProjectors: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    return (
      `Projection state is incomplete: missing cursor rows for ${this.missingProjectors.join(", ")} ` +
      `(present: ${this.knownProjectors.join(", ") || "none"}). ` +
      "The snapshot sequence cannot be derived; restart the server so the projection " +
      "bootstrap can rebuild the missing cursors, or run repair local state."
    );
  }
}

export const isPersistenceError = (u: unknown) =>
  Schema.is(PersistenceSqlError)(u) ||
  Schema.is(PersistenceDecodeError)(u) ||
  Schema.is(ProjectionStateIncompleteError)(u);

export class MigrationSchemaTooNewError extends Schema.TaggedErrorClass<MigrationSchemaTooNewError>()(
  "MigrationSchemaTooNewError",
  {
    databaseMigrationId: Schema.Number,
    latestSupportedMigrationId: Schema.Number,
  },
) {
  override get message(): string {
    return (
      `Database schema migration ${this.databaseMigrationId} is newer than this Glade build ` +
      `(latest supported migration: ${this.latestSupportedMigrationId}). ` +
      "Refusing writable startup; upgrade Glade or restore a compatible database backup."
    );
  }
}

export class MigrationLineageUnsupportedError extends Schema.TaggedErrorClass<MigrationLineageUnsupportedError>()(
  "MigrationLineageUnsupportedError",
  { databaseMigrationId: Schema.Number },
) {
  override get message(): string {
    return (
      `Database migration history ${this.databaseMigrationId} comes from a Glade preview before 0.1.0, ` +
      "which this build cannot open. Quit Glade and move state.sqlite out of the Glade data directory to start fresh."
    );
  }
}

export type OrchestrationEventStoreError = PersistenceSqlError | PersistenceDecodeError;

export type OrchestrationCommandReceiptRepositoryError =
  | PersistenceSqlError
  | PersistenceDecodeError;

export type ProviderSessionRuntimeRepositoryError = PersistenceSqlError | PersistenceDecodeError;

export type ProjectionRepositoryError =
  | PersistenceSqlError
  | PersistenceDecodeError
  | ProjectionStateIncompleteError;

export type AuthPairingLinkRepositoryError = PersistenceSqlError | PersistenceDecodeError;

export type AuthSessionRepositoryError = PersistenceSqlError | PersistenceDecodeError;
