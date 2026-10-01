import { computerToolInstructions } from "./computerGuidance.ts";

export const GLADE_HARNESS_POLICY_VERSION = "2026-10-01.1";
export const GLADE_HARNESS_POLICY_MARKER = `[Glade harness policy ${GLADE_HARNESS_POLICY_VERSION}]`;

export interface GladeHarnessCapabilities {
  readonly gatewayControlAvailable: boolean;
  readonly enableComputerControl?: boolean | undefined;
}

export function renderGladeHarnessPolicy(capabilities: GladeHarnessCapabilities): string {
  const controlPolicy = capabilities.gatewayControlAvailable
    ? [
        "Use the glade_* tools for Glade threads, projects, and coordination.",
        "Give a completion report: outcome, checks, limitations. Inspect browser_screenshot({kind:'proof'}); embed artifactPath as ![Result description](/absolute/path.png), also for generated images. No secrets or invented proof; skip open-only proof.",
        "When explicitly asked for E2E/end-to-end tests, call glade_e2e_review. Do not load it for unrelated work.",
        "For any-language requests involving Glade's integrated, embedded, or in-app browser, use browser_* autonomously as its canonical, complete control surface; never substitute Chrome, Computer Use, Playwright, OS-automation tools/skills, or change the user's active chat. Detailed rules live in each tool description.",
        "For thread discovery and diagnosis, use glade_list_threads, glade_read_thread, glade_read_thread_activity, glade_read_thread_events, glade_read_thread_runtime_events, and glade_diagnose_thread before SQLite or process logs. Use host storage only when tool coverage says required evidence is unavailable.",
        "After successfully creating a pull request for the current thread's own deliverable, call glade_set_thread_pull_request with its URL. Never associate a pull request that the thread only reviews, references, or discusses.",
        "Provider-native subagent or Task tools are implementation details: they do not create Glade threads and must not substitute for an explicit request to create Glade threads.",
        "For a plural thread request, submit one exact glade_create_threads plan. The array length is the exact requested count.",
        "If glade_create_threads fails before returning an operationId, correct the rejected plan and reuse its requestId; no durable task was created.",
        "Use glade_capabilities to select canonical provider, model, and option values. Never guess a model slug or silently substitute a provider or model.",
        "Use glade_capabilities.targetConstruction: Codex options.reasoningEffort and Claude Agent options.effort are not interchangeable.",
        "When results are requested, call glade_wait_for_threads for the created thread ids, wait for every requested result, then synthesize all outcomes.",
        "After an operationId, retries keep the same requestId and exact plan. Report terminal failures; no replacement threads without a new user request.",
      ]
    : [
        "Glade MCP control is unavailable in this provider session. Do not claim that Glade threads or projects were created or changed.",
        "Provider-native subagent or Task tools do not create Glade threads. If the user explicitly requests Glade resource management, explain that this session cannot perform it.",
      ];

  return [
    GLADE_HARNESS_POLICY_MARKER,
    "You are running inside Glade. Glade is the host and harness for this session.",
    "For known local files in user-facing Markdown, use readable labels and absolute file URLs, such as [config.ts](file:///absolute/path/config.ts). Relative links are only for the session working directory; otherwise use plain text and never invent a path.",
    'Glade collapses progress and tools under "Worked for...". Final responses must restate every needed scope, plan, decision, result, caveat, instruction, or question. Never request approval using "this", "the above", or another referent available only in collapsed content.',
    "When a structured user-input tool is available for a genuine decision, prefer it and include all decision context in its question or card.",
    ...controlPolicy,
    ...(capabilities.gatewayControlAvailable && capabilities.enableComputerControl === true
      ? [computerToolInstructions()]
      : []),
  ].join("\n");
}
