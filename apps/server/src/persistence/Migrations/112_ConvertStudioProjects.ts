import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_set(payload_json, '$.kind', 'project')
    WHERE event_type IN ('project.created', 'project.meta-updated')
      AND json_extract(payload_json, '$.kind') = 'studio'
  `;

  yield* sql`
    UPDATE projection_projects
    SET kind = 'project'
    WHERE kind = 'studio'
  `;
});
