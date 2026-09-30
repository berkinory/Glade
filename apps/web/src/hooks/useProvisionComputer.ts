import type {
  ComputerPermission,
  ComputerProvisionResult,
} from "@glade/contracts/computer/computer";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";

import { toastManager } from "~/components/ui/toast";
import {
  computerProvisionErrorToast,
  computerProvisionNote,
  computerProvisionOutcome,
  computerProvisionResultToast,
  computerProvisionStartToast,
} from "~/lib/computerProvisioning";
import { provisionComputer, serverQueryKeys } from "~/lib/serverReactQuery";

const COMPUTER_PROVISION_MUTATION_KEY = ["computer", "provision"] as const;

export interface UseProvisionComputerResult {
  readonly provision: () => void;
  readonly isPending: boolean;

  readonly note: string | undefined;
}

export function useProvisionComputer(options?: {
  readonly missing?: readonly ComputerPermission[];
  // Toasts are how a transcript card reports; the settings panel keeps the same words in an inline
  // row instead and would otherwise say everything twice.
  readonly notify?: boolean;

  readonly onReady?: (result: ComputerProvisionResult) => void;
}): UseProvisionComputerResult {
  const notify = options?.notify ?? false;
  const missing = options?.missing;
  const onReady = options?.onReady;
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationKey: COMPUTER_PROVISION_MUTATION_KEY,
    mutationFn: provisionComputer,
    onSuccess: (result) => {
      if (globalThis.window?.desktopBridge?.computerPermissions) {
        void queryClient.invalidateQueries({ queryKey: serverQueryKeys.computerStatus() });
      } else {
        queryClient.setQueryData(serverQueryKeys.computerStatus(), result.status);
      }
      if (
        notify &&
        (!globalThis.window?.desktopBridge?.computerPermissions ||
          computerProvisionOutcome(result) === "ready")
      )
        toastManager.add(computerProvisionResultToast(result));
      if (computerProvisionOutcome(result) === "ready") onReady?.(result);
    },
    onError: (error: unknown) => {
      if (notify) toastManager.add(computerProvisionErrorToast(error));
    },
  });

  const isPending = useIsMutating({ mutationKey: COMPUTER_PROVISION_MUTATION_KEY }) > 0;
  const { mutate } = mutation;
  const provision = () => {
    if (queryClient.isMutating({ mutationKey: COMPUTER_PROVISION_MUTATION_KEY }) > 0) return;
    if (notify) toastManager.add(computerProvisionStartToast(missing));
    mutate();
  };

  return {
    provision,
    isPending,
    note: computerProvisionNote({
      isPending,
      ...(missing ? { missing } : {}),
      error: mutation.error,
      result: globalThis.window?.desktopBridge?.computerPermissions ? undefined : mutation.data,
    }),
  };
}
