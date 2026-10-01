import { EventId, RuntimeRequestId, ThreadId } from "@glade/contracts/core/baseSchemas";
import type { ProviderRuntimeEvent } from "@glade/contracts/provider/runtimeEvents";
import { expect, it } from "vitest";

import { projectProviderRuntimeActivities } from "./runtimeActivityProjection";

it("redacts nested credentials from structured and preformatted approval parameters", () => {
  const configuration = {
    apiKey: "fixture-api-credential",
    nested: { password: "fixture-password-credential", mode: "safe" },
  };
  const requests = [
    { toolName: "configure", input: { configuration } },
    {
      _meta: {
        tool_name: "configure",
        tool_params_display: [{ name: "configuration", value: JSON.stringify(configuration) }],
      },
    },
  ];

  for (const [index, args] of requests.entries()) {
    const event: ProviderRuntimeEvent = {
      type: "request.opened",
      eventId: EventId.makeUnsafe(`approval-credentials-${index}`),
      provider: "codex",
      createdAt: "2026-09-30T00:00:00.000Z",
      threadId: ThreadId.makeUnsafe("credential-verification"),
      requestId: RuntimeRequestId.makeUnsafe(`credential-request-${index}`),
      payload: { requestType: "tool_approval", args },
    };
    const activities = projectProviderRuntimeActivities(event);

    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      kind: "approval.requested",
      payload: { toolName: "configure", toolParamsDisplay: [expect.any(Object)] },
    });
    const encoded = JSON.stringify(activities);
    expect(encoded).not.toContain(configuration.apiKey);
    expect(encoded).not.toContain(configuration.nested.password);
    expect(encoded).toContain("[redacted]");
    expect(encoded).toContain(configuration.nested.mode);
  }
});
