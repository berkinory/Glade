import { Schema } from "effect";
import { TrimmedNonEmptyString } from "../core/baseSchemas";

export const GitPublishContextInput = Schema.Struct({ cwd: TrimmedNonEmptyString });
export type GitPublishContextInput = typeof GitPublishContextInput.Type;

export const GitPublishContextResult = Schema.Struct({
  hasRemote: Schema.Boolean,
  owner: Schema.NullOr(TrimmedNonEmptyString),
  owners: Schema.Array(
    Schema.Struct({
      login: TrimmedNonEmptyString,
      kind: Schema.Literals(["user", "organization"]),
    }),
  ),
  name: TrimmedNonEmptyString,
});
export type GitPublishContextResult = typeof GitPublishContextResult.Type;

export const GitPublishRepositoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  owner: TrimmedNonEmptyString.check(
    Schema.isPattern(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/),
  ),
  name: TrimmedNonEmptyString.check(Schema.isPattern(/^[A-Za-z0-9._-]{1,100}$/)),
  visibility: Schema.Literals(["private", "public"]),
});
export type GitPublishRepositoryInput = typeof GitPublishRepositoryInput.Type;

export const GitPublishRepositoryResult = Schema.Union([
  Schema.Struct({ status: Schema.Literal("published"), url: TrimmedNonEmptyString }),
  Schema.Struct({
    status: Schema.Literal("pushFailed"),
    url: TrimmedNonEmptyString,
    error: TrimmedNonEmptyString,
  }),
]);
export type GitPublishRepositoryResult = typeof GitPublishRepositoryResult.Type;
