import { MessageId, ThreadId } from "@glade/contracts/core/baseSchemas";
import { beforeAll, vi } from "vitest";

export const TOOLTIP_TRIGGER_MARKER = 'data-base-ui-tooltip-trigger=""';
export const FORK_SOURCE = {
  sourceThreadId: ThreadId.makeUnsafe("source-thread"),
  sourceTitle: "ciao (2)",
};

export function makeForkImportedEntry() {
  return {
    id: "imported-entry",
    kind: "message" as const,
    createdAt: "2026-03-17T19:12:28.000Z",
    message: {
      id: MessageId.makeUnsafe("imported-message"),
      role: "assistant" as const,
      text: "Imported history",
      createdAt: "2026-03-17T19:12:28.000Z",
      streaming: false,
      source: "fork-import" as const,
    },
  };
}

export function makeForkOwnedEntry() {
  return {
    id: "fork-entry",
    kind: "message" as const,
    createdAt: "2026-03-17T19:12:29.000Z",
    message: {
      id: MessageId.makeUnsafe("fork-message"),
      role: "user" as const,
      text: "Fork-only turn",
      createdAt: "2026-03-17T19:12:29.000Z",
      streaming: false,
      source: "native" as const,
    },
  };
}

vi.mock("@legendapp/list/react", async () => {
  const React = await import("react");

  const LegendList = React.forwardRef(function MockLegendList(
    props: {
      data: Array<{ id: string }>;
      keyExtractor: (item: { id: string }) => string;
      renderItem: (args: { item: { id: string } }) => React.ReactNode;
      ListFooterComponent?: React.ReactNode;
    },
    _ref: React.ForwardedRef<unknown>,
  ) {
    return (
      <div data-testid="legend-list">
        {props.data.map((item) => (
          <div key={props.keyExtractor(item)}>{props.renderItem({ item })}</div>
        ))}
        {props.ListFooterComponent}
      </div>
    );
  });

  return { LegendList };
});

export function makeTimelineBaseProps() {
  return {
    hasMessages: true,
    isWorking: false,
    activeTurnInProgress: false,
    turnDiffSummaryByAssistantMessageId: new Map(),
    nowIso: "2026-03-17T19:12:30.000Z",
    expandedWorkGroups: {},
    onToggleWorkGroup: () => {},
    onOpenTurnDiff: () => {},
    isRevertingCheckpoint: false,
    onImageExpand: () => {},
    markdownCwd: undefined,
    resolvedTheme: "dark" as const,
    timestampFormat: "locale" as const,
    workspaceRoot: undefined,
  };
}

function matchMedia() {
  return {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

beforeAll(() => {
  const classList = {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false,
  };

  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  });
  vi.stubGlobal("window", {
    matchMedia,
    addEventListener: () => {},
    removeEventListener: () => {},
    desktopBridge: undefined,
  });
  vi.stubGlobal("document", {
    documentElement: {
      classList,
      offsetHeight: 0,
    },

    addEventListener: () => {},
    removeEventListener: () => {},
    visibilityState: "visible",
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

beforeAll(async () => {
  await import("./MessagesTimeline");
}, 120_000);
