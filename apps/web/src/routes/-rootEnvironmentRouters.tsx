import { Fragment, useEffect, useMemo, useRef } from "react";
import { toastManager } from "../components/ui/toast";
import { LOCAL_ENVIRONMENT } from "../environments/environmentKey";
import { environmentStore } from "../environments/environmentStores";
import { startRemoteEnvironments, useRemoteEnvironments } from "../environments/remoteEnvironments";
import { readLocalNativeApi } from "../nativeApi";
import { onServerWelcome, onThreadStreamFailure } from "../wsNativeApi";
import { EnvironmentEventRouter } from "./-rootEventRouter";
import { HostProviderUpdates } from "./-rootProviders";

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
          title: "Host runs a newer Glade",
          description: `${environment.host.label} runs a newer Glade. Update this app to see its projects and chats. They are safe on the host.`,
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
            <HostProviderUpdates
              environmentKey={environment.key}
              hostLabel={environment.host.label}
              api={environment.api.api}
            />
          </Fragment>
        ) : null,
      )}
    </>
  );
}
