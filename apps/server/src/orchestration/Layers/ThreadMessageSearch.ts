import { ThreadId } from "@glade/contracts/core/baseSchemas";
import { THREAD_MESSAGE_SEARCH_MAX_EXCERPT_LENGTH } from "@glade/contracts/orchestration/rpc";
import { foldSearchText } from "@glade/shared/text/searchQuery";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { toPersistenceSqlError } from "../../persistence/Errors.ts";
import {
  ThreadMessageSearch,
  type ThreadMessageSearchShape,
} from "../Services/ThreadMessageSearch.ts";

const DEFAULT_LIMIT = 20;
const EXCERPT_CONTEXT_BEFORE = 60;
const ELLIPSIS = "...";

interface SearchRow {
  readonly threadId: string;
  readonly body: string;
  readonly matchCount: number;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ");
}

function tokenize(query: string): string[] {
  return [...new Set(foldSearchText(normalizeWhitespace(query)).split(" "))].filter(
    (token) => token.length > 0,
  );
}

let nonAsciiSpellingsByKey: ReadonlyMap<string, readonly string[]> | null = null;

// Non-ASCII characters whose search key is a different single character ("i" -> ["İ", "ı"]).
function nonAsciiSpellings(): ReadonlyMap<string, readonly string[]> {
  if (nonAsciiSpellingsByKey) return nonAsciiSpellingsByKey;
  const spellings = new Map<string, string[]>();
  for (let code = 0x80; code <= 0xffff; code += 1) {
    if (code >= 0xd800 && code <= 0xdfff) continue;
    const char = String.fromCharCode(code);
    const key = foldSearchText(char);
    if (key !== char && key.length === 1) spellings.set(key, [...(spellings.get(key) ?? []), char]);
  }
  nonAsciiSpellingsByKey = spellings;
  return spellings;
}

function escapeLike(value: string): string {
  return value.replaceAll(/[\\%_]/g, (char) => `\\${char}`);
}

// SQLite's LIKE folds ASCII only and neither runtime ships ICU. A token whose letters all fold in
// ASCII is one LIKE. Otherwise the body's non-ASCII spellings of the token's letters are rewritten
// to their search key before the LIKE, which then matches exactly what foldSearchText matches on the
// client. Rewriting copies the whole body, so a LIKE with those letters left as gaps runs first and
// only its survivors pay for the rewrite.
function tokenMatchPlan(token: string): {
  readonly exact: string;
  readonly prefilter: string | null;
  readonly replacements: ReadonlyArray<readonly [string, string]>;
} {
  const spellings = nonAsciiSpellings();
  const replacements: Array<readonly [string, string]> = [];
  let prefilter = "%";
  for (const char of new Set(token)) {
    for (const spelling of spellings.get(char) ?? []) replacements.push([spelling, char]);
  }
  for (const char of token) {
    if (spellings.has(char)) prefilter += prefilter.endsWith("%") ? "" : "%";
    else prefilter += escapeLike(char);
  }
  const exact = `%${escapeLike(token)}%`;
  return {
    exact,
    prefilter: replacements.length > 0 ? `${prefilter}${prefilter.endsWith("%") ? "" : "%"}` : null,
    replacements,
  };
}

function trimLoneSurrogates(value: string): string {
  return value.replace(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/g, "");
}

function buildExcerpt(body: string, tokens: readonly string[]): string {
  const display = normalizeWhitespace(body);
  if (display.length <= THREAD_MESSAGE_SEARCH_MAX_EXCERPT_LENGTH) return display;
  const folded = foldSearchText(display);
  const hitIndexes = tokens.map((token) => folded.indexOf(token)).filter((index) => index >= 0);
  const hitIndex = hitIndexes.length > 0 ? Math.min(...hitIndexes) : 0;
  const maxBody = THREAD_MESSAGE_SEARCH_MAX_EXCERPT_LENGTH - ELLIPSIS.length * 2;
  const start = Math.min(Math.max(0, hitIndex - EXCERPT_CONTEXT_BEFORE), display.length - maxBody);
  const end = start + maxBody;
  const slice = trimLoneSurrogates(display.slice(start, end)).trim();
  return `${start > 0 ? ELLIPSIS : ""}${slice}${end < display.length ? ELLIPSIS : ""}`;
}

const makeThreadMessageSearch = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const search: ThreadMessageSearchShape["search"] = (input) =>
    Effect.gen(function* () {
      const tokens = tokenize(input.query);
      if (tokens.length === 0) return { matches: [] };
      // Settled bodies live in `text`, or JSON-encoded in `text_json` when they hold NULs or lone
      // surrogates. Streaming rows are skipped: their text is split across chunk rows until settled.
      const body = sql`COALESCE(json_extract(messages.text_json, '$'), messages.text)`;
      const tokenPredicates = sql.and(
        tokens.map((token) => {
          const plan = tokenMatchPlan(token);
          const folded = plan.replacements.reduce(
            (expression, [spelling, key]) => sql`replace(${expression}, ${spelling}, ${key})`,
            body,
          );
          const exact = sql`${folded} LIKE ${plan.exact} ESCAPE '\\'`;
          return plan.prefilter === null
            ? exact
            : sql`${body} LIKE ${plan.prefilter} ESCAPE '\\' AND ${exact}`;
        }),
      );
      // Matches the sidebar: no archived, deleted or subagent chats, and nothing from deleted projects.
      const rows = yield* sql<SearchRow>`
        WITH hits AS (
          SELECT
            messages.thread_id,
            messages.message_id,
            messages.role,
            messages.created_at,
            ${body} AS body,
            threads.updated_at AS thread_updated_at
          FROM projection_thread_messages AS messages
          INNER JOIN projection_threads AS threads ON threads.thread_id = messages.thread_id
          INNER JOIN projection_projects AS projects ON projects.project_id = threads.project_id
          WHERE threads.deleted_at IS NULL
            AND threads.archived_at IS NULL
            AND threads.parent_thread_id IS NULL
            AND projects.deleted_at IS NULL
            AND messages.is_streaming = 0
            AND messages.role IN ('user', 'assistant')
            AND ${tokenPredicates}
        ),
        ranked AS (
          SELECT
            thread_id,
            body,
            thread_updated_at,
            COUNT(*) OVER (PARTITION BY thread_id) AS match_count,
            ROW_NUMBER() OVER (
              PARTITION BY thread_id
              ORDER BY CASE role WHEN 'user' THEN 0 ELSE 1 END, created_at DESC, message_id
            ) AS thread_rank
          FROM hits
        )
        SELECT thread_id AS "threadId", body, match_count AS "matchCount"
        FROM ranked
        WHERE thread_rank = 1
        ORDER BY thread_updated_at DESC, thread_id
        LIMIT ${input.limit ?? DEFAULT_LIMIT}
      `.pipe(Effect.mapError(toPersistenceSqlError("ThreadMessageSearch.search")));

      return {
        matches: rows.map((row) => ({
          threadId: ThreadId.makeUnsafe(row.threadId),
          excerpt: buildExcerpt(row.body, tokens),
          matchCount: row.matchCount,
        })),
      };
    });

  return { search } satisfies ThreadMessageSearchShape;
});

export const ThreadMessageSearchLive = Layer.effect(ThreadMessageSearch, makeThreadMessageSearch);
