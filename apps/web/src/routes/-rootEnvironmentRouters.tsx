import type { NativeApi } from "@glade/contracts/ipc/ipc";
import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useRef } from "react";
import { toastManager } from "../components/ui/toast";
import { LOCAL_ENVIRONMENT, type EnvironmentKey } from "../environments/environmentKey";
import { environmentServerConfigQueryOptions } from "../lib/serverReactQuery";
import { environmentStore } from "../environments/environmentStores";
import { startRemoteEnvironments, useRemoteEnvironments } from "../environments/remoteEnvironments";
import { readLocalNativeApi } from "../nativeApi";
import { onServerWelcome, onThreadStreamFailure } from "../wsNativeApi";
import { EnvironmentEventRouter } from "./-rootEventRouter";

// A server probes its providers only when a client asks. This app asks its own server at startup;
// a host's server is asked once per connection, so its chats know which providers it has.
function HostProviderRefresh(props: {
  readonly environmentKey: EnvironmentKey;
  readonly api: NativeApi;
}) {
  const queryClient = useQueryClient();
  const { api, environmentKey } = props;
  useEffect(() => {
    let cancelled = false;
    void api.server
      .refreshProviders()
      .then(() => {
        if (cancelled) return;
        void queryClient.invalidateQueries({
          queryKey: environmentServerConfigQueryOptions(environmentKey).queryKey,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, environmentKey, queryClient]);
  return null;
}

// One stream runtime per environment: the local server, plus every SSH host that is reachable.
export function EnvironmentRouters() {
  const remoteEnvironments = useRemoteEnvironments();
  const localApi = readLocalNativeApi();
  const localStore = environmentStore(LOCAL_ENVIRONMENT);
  const localConnection = useMemo(
    () => (localApi ? { api: localApi, onWelcome: onServerWelcome, onThreadStreamFailure } : null),
    [localApi],
  );

  useEffect(() => {
    startRemoteEnvironments();
  }, []);

  // A host on a newer protocol hides its projects until this app is updated; say so once, since the
  // sidebar alone would only show them missing.
  const reportedIncompatible = useRef(new Set<string>());
  useEffect(() => {
    for (const environment of remoteEnvironments) {
      const reported = reportedIncompatible.current.has(environment.key);
      if (environment.incompatible && !reported) {
        reportedIncompatible.current.add(environment.key);
        toastManager.add({
          type: "warning",
          title: `${environment.host.label} runs a newer Glade`,
          description: "Update this app to see its projects and chats. They are safe on the host.",
        });
      } else if (!environment.incompatible && reported) {
        reportedIncompatible.current.delete(environment.key);
      }
    }
  }, [remoteEnvironments]);

  return (
    <>
      {localConnection && localStore ? (
        <EnvironmentEventRouter
          environmentKey={LOCAL_ENVIRONMENT}
          connection={localConnection}
          store={localStore}
        />
      ) : null}
      {remoteEnvironments.map((environment) =>
        environment.api ? (
          <Fragment key={environment.key}>
            <EnvironmentEventRouter
              environmentKey={environment.key}
              connection={environment.api}
              store={environment.store}
            />
            <HostProviderRefresh environmentKey={environment.key} api={environment.api.api} />
          </Fragment>
        ) : null,
      )}
    </>
  );
}
