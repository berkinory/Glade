import { ProjectId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { type OrchestrationThreadShell } from "@glade/contracts/orchestration/threadEntities";
import { type ProviderSession } from "@glade/contracts/provider/provider";
import { describe, expect, it } from "vitest";

import type { ProviderRuntimeBinding } from "../Services/ProviderSessionDirectory.ts";
import { planProviderRuntimeReconciliation } from "./providerRuntimeReconciliation.ts";

const THREAD_ID = ThreadId.makeUnsafe("thread-stalled-start");
const STARTED_AT = "2026-10-12T10:00:00.000Z";
const MINUTE_MS = 60_000;

const stalledStartThread = {
  id: THREAD_ID,
  projectId: ProjectId.makeUnsafe("project-stalled-start"),
  modelSelection: { provider: "codex", model: "gpt-5" },
  updatedAt: STARTED_AT,
  latestTurn: null,
  session: {
    threadId: THREAD_ID,
    status: "starting",
    providerName: "codex",
    runtimeMode: "full-access",
    activeTurnId: null,
    lastError: null,
    updatedAt: STARTED_AT,
  },
} as unknown as OrchestrationThreadShell;

const binding = {
  threadId: THREAD_ID,
  provider: "codex",
  status: "running",
  runtimePayload: { activeTurnId: null },
} as unknown as ProviderRuntimeBinding;

const liveSession = (status: ProviderSession["status"]): ProviderSession => ({
  provider: "codex",
  status,
  runtimeMode: "full-access",
  threadId: THREAD_ID,
  createdAt: STARTED_AT,
  updatedAt: STARTED_AT,
});

describe("planProviderRuntimeReconciliation stalled starts", () => {
  it.each([
    {
      label: "settles a start stalled past the bound",
      ageMinutes: 11,
      live: "ready",
      settles: true,
    },
    { label: "waits while the start is recent", ageMinutes: 5, live: "ready", settles: false },
    {
      label: "leaves a connection the adapter still owns alone",
      ageMinutes: 11,
      live: "connecting",
      settles: false,
    },
  ] as const)("$label", ({ ageMinutes, live, settles }) => {
    const plans = planProviderRuntimeReconciliation({
      threads: [stalledStartThread],
      bindings: [binding],
      liveSessions: [liveSession(live)],
      pumpHealth: [],
      nowMs: Date.parse(STARTED_AT) + ageMinutes * MINUTE_MS,
    });

    expect(plans.map((plan) => plan.action)).toEqual(settles ? ["settle-interrupted"] : []);
  });
});
