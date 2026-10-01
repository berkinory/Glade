import { describe, expect, it } from "vitest";
import { buildCodexThreadOpenRequest } from "../codexAppServerManager";

describe("buildCodexThreadOpenRequest", () => {
  const sessionOverrides = {
    model: null,
    cwd: "/tmp/project",
    approvalPolicy: "never" as const,
    approvalsReviewer: "user" as const,
    sandbox: "danger-full-access" as const,
  };

  it("starts a fresh thread with raw events disabled", () => {
    const request = buildCodexThreadOpenRequest({ sessionOverrides });
    expect(request).toEqual({
      method: "thread/start",
      params: {
        ...sessionOverrides,
        experimentalRawEvents: false,
      },
    });
    expect(request.params).not.toHaveProperty("excludeTurns");
  });

  it("rejects conflicting resume and fork sources", () => {
    expect(() =>
      buildCodexThreadOpenRequest({
        forkSourceThreadId: "fork-source",
        resumeThreadId: "resume-source",
        sessionOverrides,
      }),
    ).toThrow("cannot resume and fork at the same time");
  });
});
