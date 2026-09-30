import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Schema } from "effect";
import { ProjectionSpace } from "../../persistence/Services/ProjectionSpaces.ts";
import {
  ProjectionProjectDbRowSchema,
  ProjectionThreadDbRowSchema,
  ProjectionThreadShellDbRowSchema,
  ProjectionStateDbRowSchema,
  EmptyProjectShellRepairRowSchema,
  ProjectionCountsRowSchema,
} from "./snapshotSchemas";

export function makeSnapshotBaseQueries(input: { readonly sql: SqlClient.SqlClient }) {
  const { sql } = input;
  const listSpaceRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionSpace,
    execute: () =>
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
        ORDER BY sort_order ASC, space_id ASC
      `,
  });

  const listProjectRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProjectDbRowSchema,
    execute: () =>
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
        ORDER BY created_at ASC, project_id ASC
      `,
  });

  const listThreadRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
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
        ORDER BY created_at ASC, thread_id ASC
      `,
  });

  const listThreadShellRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadShellDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          env_mode AS "envMode",
          branch,
          worktree_path AS "worktreePath",
          working_directory AS "workingDirectory",
          associated_worktree_path AS "associatedWorktreePath",
          associated_worktree_branch AS "associatedWorktreeBranch",
          associated_worktree_ref AS "associatedWorktreeRef",
          create_branch_flow_completed AS "createBranchFlowCompleted",
          is_pinned AS "isPinned",
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
        ORDER BY created_at ASC, thread_id ASC
      `,
  });

  const listProjectionStateRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionStateDbRowSchema,
    execute: () =>
      sql`
        SELECT
          projector,
          last_applied_sequence AS "lastAppliedSequence",
          updated_at AS "updatedAt"
        FROM projection_state
      `,
  });

  const readEmptyProjectShellRepair = SqlSchema.findOne({
    Request: Schema.Void,
    Result: EmptyProjectShellRepairRowSchema,
    execute: () =>
      sql`
        SELECT EXISTS (
          SELECT 1
          FROM orchestration_events AS created
          WHERE created.aggregate_kind = 'project'
            AND created.event_type = 'project.created'
            AND NOT EXISTS (
              SELECT 1
              FROM orchestration_events AS deleted
              WHERE deleted.aggregate_kind = 'project'
                AND deleted.stream_id = created.stream_id
                AND deleted.event_type = 'project.deleted'
                AND deleted.sequence > created.sequence
            )
        ) AS required
      `,
  });

  const readProjectionCounts = SqlSchema.findOne({
    Request: Schema.Void,
    Result: ProjectionCountsRowSchema,
    execute: () =>
      sql`
        SELECT
          (SELECT COUNT(*) FROM projection_projects) AS "projectCount",
          (SELECT COUNT(*) FROM projection_threads) AS "threadCount"
      `,
  });
  return {
    listSpaceRows,
    listProjectRows,
    listThreadRows,
    listProjectionStateRows,
    listThreadShellRows,
    readEmptyProjectShellRepair,
    readProjectionCounts,
  };
}
