import type { NativeApi } from "@glade/contracts/ipc/ipc";
import type { ProjectId } from "@glade/contracts/core/baseSchemas";

import { newCommandId } from "./utils";

interface DeleteProjectFromClientInput {
  api: Pick<NativeApi["orchestration"], "dispatchCommand">;
  projectId: ProjectId;
  removeDeletedProjectFromClientState: (projectId: ProjectId) => void;
}

export async function deleteProjectFromClient(input: DeleteProjectFromClientInput): Promise<void> {
  await input.api.dispatchCommand({
    type: "project.delete",
    commandId: newCommandId(),
    projectId: input.projectId,
  });
  input.removeDeletedProjectFromClientState(input.projectId);
}
