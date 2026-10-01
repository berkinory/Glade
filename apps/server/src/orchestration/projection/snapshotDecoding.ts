import { Schema, Effect, Option } from "effect";
import { ModelSelection } from "@glade/contracts/provider/sessionPolicy";
import {
  type ProjectionRepositoryError,
  toPersistenceDecodeError,
} from "../../persistence/Errors.ts";
import {
  ProjectionProjectDbRowRaw,
  ProjectionProjectDbRow,
  ProjectionThreadDbRowRaw,
  ProjectionThreadDbRow,
  ProjectionThreadShellDbRowRaw,
  ProjectionThreadShellDbRow,
} from "./snapshotSchemas";

const decodeModelSelection = Schema.decodeUnknownEffect(ModelSelection);

function decodeProjectionProjectRow(
  row: ProjectionProjectDbRowRaw,
): Effect.Effect<ProjectionProjectDbRow, Schema.SchemaError> {
  if (row.defaultModelSelection === null) {
    return Effect.succeed({ ...row, defaultModelSelection: null });
  }
  return decodeModelSelection(row.defaultModelSelection).pipe(
    Effect.map((defaultModelSelection) => ({ ...row, defaultModelSelection })),
  );
}

function decodeProjectionThreadRow(
  row: ProjectionThreadDbRowRaw,
): Effect.Effect<ProjectionThreadDbRow, Schema.SchemaError> {
  return decodeModelSelection(row.modelSelection).pipe(
    Effect.map((modelSelection) => ({ ...row, modelSelection })),
  );
}

function decodeProjectionThreadShellRow(
  row: ProjectionThreadShellDbRowRaw,
): Effect.Effect<ProjectionThreadShellDbRow, Schema.SchemaError> {
  return decodeModelSelection(row.modelSelection).pipe(
    Effect.map((modelSelection) => ({ ...row, modelSelection })),
  );
}

export function decodeProjectionProjectRows(
  rows: ReadonlyArray<ProjectionProjectDbRowRaw>,
  operation: string,
): Effect.Effect<ReadonlyArray<ProjectionProjectDbRow>, ProjectionRepositoryError> {
  return Effect.forEach(rows, decodeProjectionProjectRow).pipe(
    Effect.mapError(toPersistenceDecodeError(operation)),
  );
}

export function decodeProjectionThreadRows(
  rows: ReadonlyArray<ProjectionThreadDbRowRaw>,
  operation: string,
): Effect.Effect<ReadonlyArray<ProjectionThreadDbRow>, ProjectionRepositoryError> {
  return Effect.forEach(rows, decodeProjectionThreadRow).pipe(
    Effect.mapError(toPersistenceDecodeError(operation)),
  );
}

export function decodeProjectionThreadShellRows(
  rows: ReadonlyArray<ProjectionThreadShellDbRowRaw>,
  operation: string,
): Effect.Effect<ReadonlyArray<ProjectionThreadShellDbRow>, ProjectionRepositoryError> {
  return Effect.forEach(rows, decodeProjectionThreadShellRow).pipe(
    Effect.mapError(toPersistenceDecodeError(operation)),
  );
}

export function decodeProjectionProjectOption(
  option: Option.Option<ProjectionProjectDbRowRaw>,
  operation: string,
): Effect.Effect<Option.Option<ProjectionProjectDbRow>, ProjectionRepositoryError> {
  if (Option.isNone(option)) {
    return Effect.succeed(Option.none());
  }
  return decodeProjectionProjectRow(option.value).pipe(
    Effect.map(Option.some),
    Effect.mapError(toPersistenceDecodeError(operation)),
  );
}

export function decodeProjectionThreadOption(
  option: Option.Option<ProjectionThreadDbRowRaw>,
  operation: string,
): Effect.Effect<Option.Option<ProjectionThreadDbRow>, ProjectionRepositoryError> {
  if (Option.isNone(option)) {
    return Effect.succeed(Option.none());
  }
  return decodeProjectionThreadRow(option.value).pipe(
    Effect.map(Option.some),
    Effect.mapError(toPersistenceDecodeError(operation)),
  );
}
