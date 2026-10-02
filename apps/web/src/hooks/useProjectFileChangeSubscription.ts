import { WS_PROJECT_FILE_WATCH_CAPABILITY } from "@glade/contracts/transport/ws/wsCompatibility";
import { type ProjectFileChangeEvent } from "@glade/contracts/workspace/project";
import { useEffect, useSyncExternalStore } from "react";

import {
  onNativeApiServerCapabilitiesChange,
  readNativeApi,
  readNativeApiServerCapability,
} from "../nativeApi";

const subscribeFileWatchCapability = (listener: () => void) =>
  onNativeApiServerCapabilitiesChange(listener);
const readFileWatchCapability = () =>
  readNativeApiServerCapability(WS_PROJECT_FILE_WATCH_CAPABILITY);
const readServerFileWatchCapability = () => false;

export function useProjectFileChangeSubscription(input: {
  cwd: string | null;
  relativePath: string | null;
  enabled: boolean;
  directoryPaths?: string;
  onChange: (event: ProjectFileChangeEvent) => void;
}): void {
  const capabilityAvailable = useSyncExternalStore(
    subscribeFileWatchCapability,
    readFileWatchCapability,
    readServerFileWatchCapability,
  );

  useEffect(() => {
    if (!input.enabled || !capabilityAvailable || !input.cwd || !input.relativePath) {
      return;
    }
    const api = readNativeApi();
    return api?.projects.onFileChange?.(
      {
        cwd: input.cwd,
        relativePath: input.relativePath,
        ...(input.directoryPaths
          ? { directoryPaths: JSON.parse(input.directoryPaths) as string[] }
          : {}),
      },
      input.onChange,
    );
  }, [
    capabilityAvailable,
    input.cwd,
    input.enabled,
    input.directoryPaths,
    input.onChange,
    input.relativePath,
  ]);
}
