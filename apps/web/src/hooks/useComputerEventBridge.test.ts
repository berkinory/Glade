import type { DesktopComputerState } from "@glade/contracts/ipc/ipc";
import { QueryClient, QueryObserver, focusManager } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverQueryKeys } from "~/lib/serverReactQuery";
import { subscribeComputerPermissionStatus } from "./useComputerEventBridge";

function grantState(overrides: Partial<DesktopComputerState> = {}): DesktopComputerState {
  return {
    platform: "macos",
    supported: true,

    status: "disabled",

    accessibilityPermission: "granted",
    inputMonitoringPermission: "granted",
    screenRecordingPermission: "granted",
    message: null,
    appDisplayName: "Glade",
    ...overrides,
  };
}

function bridgeFixture(queryClient: QueryClient) {
  let onState!: (state: DesktopComputerState) => void;
  const unsubscribe = vi.fn();
  const stop = subscribeComputerPermissionStatus(queryClient, {
    onState: (listener) => {
      onState = listener;
      return unsubscribe;
    },
  });
  return { onState, stop, unsubscribe };
}

afterEach(() => {
  focusManager.setFocused(undefined);
  vi.unstubAllGlobals();
});

describe("native Computer permission status bridge", () => {
  it("refreshes the visible status while System Settings is foreground and coalesces unchanged snapshots", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryFn = vi.fn().mockResolvedValue("ready");
    queryClient.setQueryData(serverQueryKeys.computerStatus(), "missing");
    const observer = new QueryObserver(queryClient, {
      queryKey: serverQueryKeys.computerStatus(),
      queryFn,
      staleTime: Infinity,
    });
    const unsubscribeQuery = observer.subscribe(() => undefined);
    focusManager.setFocused(false);
    const bridge = bridgeFixture(queryClient);
    try {
      bridge.onState(grantState());
      await vi.waitFor(() =>
        expect(queryClient.getQueryData(serverQueryKeys.computerStatus())).toBe("ready"),
      );
      bridge.onState(grantState({ status: "ready" }));
      expect(queryFn).toHaveBeenCalledTimes(1);
      bridge.onState(grantState({ accessibilityPermission: "denied" }));
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    } finally {
      bridge.stop();
      expect(bridge.unsubscribe).toHaveBeenCalledOnce();
      unsubscribeQuery();
      queryClient.clear();
    }
  });

  it("does not create a Computer query or request native permission reads for partial grant snapshots", () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const bridge = bridgeFixture(queryClient);
    try {
      bridge.onState(grantState());
      expect(invalidate).not.toHaveBeenCalled();
      expect(queryClient.getQueryCache().getAll()).toEqual([]);
      queryClient.setQueryData(serverQueryKeys.computerStatus(), "available");
      const { accessibilityPermission: _accessibility, ...partialGrantState } = grantState({
        screenRecordingPermission: "denied",
      });
      bridge.onState(partialGrantState);
      expect(invalidate).not.toHaveBeenCalled();
    } finally {
      bridge.stop();
      queryClient.clear();
    }
  });

  it("does not apply local grant pushes to a remote Computer host", () => {
    const onState = vi.fn();
    vi.stubGlobal("window", {
      desktopBridge: {
        getWsUrl: () => "wss://remote.glade.test",
        computerPermissions: { onState },
      },
    });
    const queryClient = new QueryClient();
    subscribeComputerPermissionStatus(queryClient)();
    expect(onState).not.toHaveBeenCalled();
    queryClient.clear();
  });
});
