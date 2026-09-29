import { useQuery } from "@tanstack/react-query";

import { serverEnvironmentQueryOptions } from "~/lib/serverReactQuery";

export function useDeviceSupport(): boolean {
  const environmentQuery = useQuery(serverEnvironmentQueryOptions());
  return environmentQuery.data?.platform.os === "darwin";
}
