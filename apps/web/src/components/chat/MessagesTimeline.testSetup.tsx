import { beforeAll, vi } from "vitest";

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
