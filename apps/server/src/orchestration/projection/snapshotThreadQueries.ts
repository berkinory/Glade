import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Schema } from "effect";
import { ProjectionSpace } from "../../persistence/Services/ProjectionSpaces.ts";
import { ThreadId } from "@glade/contracts/core/baseSchemas";
import {
  ProjectionManagedWorktreeThreadRowSchema,
  StaleInFlightThreadLookupInput,
  ProjectionThreadIdLookupRowSchema,
  WorkspaceRootLookupInput,
  ProjectionProjectDbRowSchema,
  SpaceIdLookupInput,
  ProjectIdLookupInput,
  ThreadIdLookupInput,
  ProjectionThreadDbRowSchema,
  SyntheticSubagentParentLookupInput,
  ProjectionThreadSessionDbRowSchema,
  ProjectionLatestTurnDbRowSchema,
  ProjectionThreadCheckpointContextThreadRowSchema,
  FullThreadDiffContextLookupInput,
  ProjectionFullThreadDiffContextRowSchema,
} from "./snapshotSchemas";

export function makeSnapshotThreadQueries(input: { readonly sql: SqlClient.SqlClient }) {
  const { sql } = input;
  const listManagedWorktreeThreadRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionManagedWorktreeThreadRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          archived_at AS "archivedAt",
          deleted_at AS "deletedAt",
          worktree_path AS "worktreePath",
          associated_worktree_path AS "associatedWorktreePath"
        FROM projection_threads
        WHERE worktree_path IS NOT NULL
           OR associated_worktree_path IS NOT NULL
        ORDER BY created_at ASC, thread_id ASC
      `,
  });

  const listStaleInFlightThreadIdRows = SqlSchema.findAll({
    Request: StaleInFlightThreadLookupInput,
    Result: ProjectionThreadIdLookupRowSchema,
    execute: ({ updatedBefore, limit }) =>
      sql`
        SELECT threads.thread_id AS "threadId"
        FROM projection_threads AS threads
        -- LEFT, not INNER: a thread whose runtime binding row was already
        -- removed is exactly the thread most likely to be stuck running with
        -- nothing left to settle it. Archived threads are included for the same
        -- reason - archiving does not stop a turn.
        LEFT JOIN provider_session_runtime AS runtime
          ON runtime.thread_id = threads.thread_id
        LEFT JOIN projection_thread_sessions AS sessions
          ON sessions.thread_id = threads.thread_id
        LEFT JOIN projection_turns AS latest_turn
          ON latest_turn.thread_id = threads.thread_id
         AND latest_turn.turn_id = threads.latest_turn_id
        WHERE threads.deleted_at IS NULL
          AND (
            (
              sessions.active_turn_id IS NOT NULL
              AND sessions.status <> 'error'
            )
            OR latest_turn.state = 'running'
            OR json_extract(runtime.runtime_payload_json, '$.activeTurnId') IS NOT NULL
          )
          -- Later of the session lifecycle timestamp and the thread timestamp:
          -- threads.updated_at advances on every appended message, so a turn
          -- that is actively streaming output is not a stale candidate.
          AND MAX(COALESCE(sessions.updated_at, threads.updated_at), threads.updated_at) <= ${updatedBefore}
        ORDER BY MAX(COALESCE(sessions.updated_at, threads.updated_at), threads.updated_at) ASC, threads.thread_id ASC
        LIMIT ${Math.max(1, Math.min(1_000, Math.floor(limit)))}
      `,
  });

  const getActiveProjectRowByWorkspaceRoot = SqlSchema.findOneOption({
    Request: WorkspaceRootLookupInput,
    Result: ProjectionProjectDbRowSchema,
    execute: ({ workspaceRoot }) =>
      sql`
        SELECT
          project_id AS "projectId",
          kind,
          title,
          workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          is_pinned AS "isPinned",
          space_id AS "spaceId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        WHERE workspace_root = ${workspaceRoot}
          AND deleted_at IS NULL
        ORDER BY CASE kind WHEN 'project' THEN 0 ELSE 1 END, created_at ASC, project_id ASC
        LIMIT 1
      `,
  });

  const getSpaceRowById = SqlSchema.findOneOption({
    Request: SpaceIdLookupInput,
    Result: ProjectionSpace,
    execute: ({ spaceId }) =>
      sql`
        SELECT
          space_id AS "spaceId",
          name,
          icon,
          sort_order AS "sortOrder",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_spaces
        WHERE space_id = ${spaceId}
          AND deleted_at IS NULL
        LIMIT 1
      `,
  });

  const getFirstActiveThreadIdByProject = SqlSchema.findOneOption({
    Request: ProjectIdLookupInput,
    Result: ProjectionThreadIdLookupRowSchema,
    execute: ({ projectId }) =>
      sql`
        SELECT
          thread_id AS "threadId"
        FROM projection_threads
        WHERE project_id = ${projectId}
          AND deleted_at IS NULL
        ORDER BY created_at ASC, thread_id ASC
        LIMIT 1
      `,
  });

  const getProjectRowById = SqlSchema.findOneOption({
    Request: ProjectIdLookupInput,
    Result: ProjectionProjectDbRowSchema,
    execute: ({ projectId }) =>
      sql`
        SELECT
          project_id AS "projectId",
          kind,
          title,
          workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          is_pinned AS "isPinned",
          space_id AS "spaceId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        WHERE project_id = ${projectId}
          AND deleted_at IS NULL
        LIMIT 1
      `,
  });

  const getAnyThreadIdRowById = SqlSchema.findOneOption({
    Request: ThreadIdLookupInput,
    Result: ProjectionThreadIdLookupRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId"
        FROM projection_threads
        WHERE thread_id = ${threadId}
        LIMIT 1
      `,
  });

  const getThreadRowById = SqlSchema.findOneOption({
    Request: ThreadIdLookupInput,
    Result: ProjectionThreadDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          env_mode AS "envMode",
          branch,
          worktree_path AS "worktreePath",
          working_directory AS "workingDirectory",
          associated_worktree_path AS "associatedWorktreePath",
          associated_worktree_branch AS "associatedWorktreeBranch",
          associated_worktree_ref AS "associatedWorktreeRef",
          create_branch_flow_completed AS "createBranchFlowCompleted",
          is_pinned AS "isPinned",
          pinned_messages_json AS "pinnedMessages",
          notes,
          parent_thread_id AS "parentThreadId",
          creation_source AS "creationSource",
          source_thread_id AS "sourceThreadId",
          source_turn_id AS "sourceTurnId",
          gateway_operation_id AS "gatewayOperationId",
          gateway_operation_index AS "gatewayOperationIndex",
          subagent_agent_id AS "subagentAgentId",
          subagent_nickname AS "subagentNickname",
          subagent_role AS "subagentRole",
          fork_source_thread_id AS "forkSourceThreadId",
          last_known_pr_json AS "lastKnownPr",
          latest_turn_id AS "latestTurnId",
          handoff_json AS "handoff",
          claude_cache_review_json AS "claudeCacheReview",
          latest_user_message_at AS "latestUserMessageAt",
          latest_human_message_at AS "latestHumanMessageAt",
          pending_approval_count AS "pendingApprovalCount",
          pending_user_input_count AS "pendingUserInputCount",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          settled_at AS "settledAt",
          deleted_at AS "deletedAt"
        FROM projection_threads
        WHERE thread_id = ${threadId}
          AND deleted_at IS NULL
        LIMIT 1
      `,
  });

  const getSyntheticSubagentParentThreadRow = SqlSchema.findOneOption({
    Request: SyntheticSubagentParentLookupInput,
    Result: ProjectionThreadDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          env_mode AS "envMode",
          branch,
          worktree_path AS "worktreePath",
          working_directory AS "workingDirectory",
          associated_worktree_path AS "associatedWorktreePath",
          associated_worktree_branch AS "associatedWorktreeBranch",
          associated_worktree_ref AS "associatedWorktreeRef",
          create_branch_flow_completed AS "createBranchFlowCompleted",
          is_pinned AS "isPinned",
          pinned_messages_json AS "pinnedMessages",
          notes,
          parent_thread_id AS "parentThreadId",
          creation_source AS "creationSource",
          source_thread_id AS "sourceThreadId",
          source_turn_id AS "sourceTurnId",
          gateway_operation_id AS "gatewayOperationId",
          gateway_operation_index AS "gatewayOperationIndex",
          subagent_agent_id AS "subagentAgentId",
          subagent_nickname AS "subagentNickname",
          subagent_role AS "subagentRole",
          fork_source_thread_id AS "forkSourceThreadId",
          last_known_pr_json AS "lastKnownPr",
          latest_turn_id AS "latestTurnId",
          handoff_json AS "handoff",
          claude_cache_review_json AS "claudeCacheReview",
          latest_user_message_at AS "latestUserMessageAt",
          latest_human_message_at AS "latestHumanMessageAt",
          pending_approval_count AS "pendingApprovalCount",
          pending_user_input_count AS "pendingUserInputCount",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          settled_at AS "settledAt",
          deleted_at AS "deletedAt"
        FROM projection_threads
        WHERE ${threadId} LIKE ('subagent:' || thread_id || ':%')
          AND deleted_at IS NULL
        ORDER BY length(thread_id) DESC, created_at ASC, thread_id ASC
        LIMIT 1
      `,
  });

  const ThreadIdsLookupInput = Schema.Struct({ threadIds: Schema.Array(ThreadId) });

  const listThreadRowsByIds = SqlSchema.findAll({
    Request: ThreadIdsLookupInput,
    Result: ProjectionThreadDbRowSchema,
    execute: ({ threadIds }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          env_mode AS "envMode",
          branch,
          worktree_path AS "worktreePath",
          working_directory AS "workingDirectory",
          associated_worktree_path AS "associatedWorktreePath",
          associated_worktree_branch AS "associatedWorktreeBranch",
          associated_worktree_ref AS "associatedWorktreeRef",
          create_branch_flow_completed AS "createBranchFlowCompleted",
          is_pinned AS "isPinned",
          pinned_messages_json AS "pinnedMessages",
          notes,
          parent_thread_id AS "parentThreadId",
          creation_source AS "creationSource",
          source_thread_id AS "sourceThreadId",
          source_turn_id AS "sourceTurnId",
          gateway_operation_id AS "gatewayOperationId",
          gateway_operation_index AS "gatewayOperationIndex",
          subagent_agent_id AS "subagentAgentId",
          subagent_nickname AS "subagentNickname",
          subagent_role AS "subagentRole",
          fork_source_thread_id AS "forkSourceThreadId",
          last_known_pr_json AS "lastKnownPr",
          latest_turn_id AS "latestTurnId",
          handoff_json AS "handoff",
          claude_cache_review_json AS "claudeCacheReview",
          latest_user_message_at AS "latestUserMessageAt",
          latest_human_message_at AS "latestHumanMessageAt",
          pending_approval_count AS "pendingApprovalCount",
          pending_user_input_count AS "pendingUserInputCount",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          settled_at AS "settledAt",
          deleted_at AS "deletedAt"
        FROM projection_threads
        WHERE thread_id IN ${sql.in(threadIds)}
          AND deleted_at IS NULL
        ORDER BY created_at ASC, thread_id ASC
      `,
  });

  const listThreadSessionRowsByThreads = SqlSchema.findAll({
    Request: ThreadIdsLookupInput,
    Result: ProjectionThreadSessionDbRowSchema,
    execute: ({ threadIds }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          status,
          provider_name AS "providerName",
          provider_session_id AS "providerSessionId",
          provider_thread_id AS "providerThreadId",
          runtime_mode AS "runtimeMode",
          active_turn_id AS "activeTurnId",
          last_error AS "lastError",
          updated_at AS "updatedAt"
        FROM projection_thread_sessions
        WHERE thread_id IN ${sql.in(threadIds)}
        ORDER BY thread_id ASC
      `,
  });

  const listLatestTurnRowsByThreads = SqlSchema.findAll({
    Request: ThreadIdsLookupInput,
    Result: ProjectionLatestTurnDbRowSchema,
    execute: ({ threadIds }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          state,
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          assistant_message_id AS "assistantMessageId"
        FROM (
          SELECT
            *,
            ROW_NUMBER() OVER (
              PARTITION BY thread_id
              ORDER BY requested_at DESC, turn_id DESC
            ) AS turn_rank
          FROM projection_turns
          WHERE thread_id IN ${sql.in(threadIds)}
            AND turn_id IS NOT NULL
        )
        WHERE turn_rank = 1
        ORDER BY thread_id ASC
      `,
  });

  const getThreadCheckpointContextThreadRow = SqlSchema.findOneOption({
    Request: ThreadIdLookupInput,
    Result: ProjectionThreadCheckpointContextThreadRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          threads.thread_id AS "threadId",
          threads.project_id AS "projectId",
          projects.kind AS "projectKind",
          projects.workspace_root AS "workspaceRoot",
          threads.env_mode AS "envMode",
          threads.worktree_path AS "worktreePath",
          threads.working_directory AS "workingDirectory"
        FROM projection_threads AS threads
        INNER JOIN projection_projects AS projects
          ON projects.project_id = threads.project_id
        WHERE threads.thread_id = ${threadId}
          AND threads.deleted_at IS NULL
        LIMIT 1
      `,
  });

  const getFullThreadDiffContextRow = SqlSchema.findOneOption({
    Request: FullThreadDiffContextLookupInput,
    Result: ProjectionFullThreadDiffContextRowSchema,
    execute: ({ threadId, checkpointTurnCount }) =>
      sql`
        SELECT
          threads.thread_id AS "threadId",
          threads.project_id AS "projectId",
          projects.kind AS "projectKind",
          projects.workspace_root AS "workspaceRoot",
          threads.env_mode AS "envMode",
          threads.worktree_path AS "worktreePath",
          threads.working_directory AS "workingDirectory",
          (
            SELECT MAX(turns.checkpoint_turn_count)
            FROM projection_turns AS turns
            WHERE turns.thread_id = threads.thread_id
              AND turns.checkpoint_turn_count IS NOT NULL
              AND turns.completed_at IS NOT NULL
          ) AS "latestCheckpointTurnCount",
          (
            SELECT turns.checkpoint_ref
            FROM projection_turns AS turns
            WHERE turns.thread_id = threads.thread_id
              AND turns.checkpoint_turn_count IS NOT NULL
              AND turns.completed_at IS NOT NULL
            ORDER BY turns.checkpoint_turn_count ASC
            LIMIT 1
          ) AS "baselineCheckpointRef",
          (
            SELECT turns.checkpoint_ref
            FROM projection_turns AS turns
            WHERE turns.thread_id = threads.thread_id
              AND turns.checkpoint_turn_count = ${checkpointTurnCount}
              AND turns.completed_at IS NOT NULL
            LIMIT 1
          ) AS "toCheckpointRef"
        FROM projection_threads AS threads
        INNER JOIN projection_projects AS projects
          ON projects.project_id = threads.project_id
        WHERE threads.thread_id = ${threadId}
          AND threads.deleted_at IS NULL
        LIMIT 1
      `,
  });
  return {
    listStaleInFlightThreadIdRows,
    listManagedWorktreeThreadRows,
    getActiveProjectRowByWorkspaceRoot,
    getProjectRowById,
    getSpaceRowById,
    getFirstActiveThreadIdByProject,
    getThreadCheckpointContextThreadRow,
    getFullThreadDiffContextRow,
    getAnyThreadIdRowById,
    getThreadRowById,
    listThreadRowsByIds,
    listLatestTurnRowsByThreads,
    listThreadSessionRowsByThreads,
    getSyntheticSubagentParentThreadRow,
  };
}
