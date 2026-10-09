import type { RemoteEnvironment } from "~/environments/remoteEnvironments";
import { ensureEnvironmentNativeApi } from "~/nativeApi";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog";
import { RemoteAccessControls } from "./RemoteAccessSettingsPanel";

// An SSH host runs its own Glade server, so a phone pairs with the host directly and keeps working
// while this computer is off.
export function HostRemoteAccessDialog(props: {
  readonly environment: RemoteEnvironment | null;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { environment } = props;
  return (
    <Dialog open={environment !== null} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-2xl">
        {environment ? (
          <>
            <DialogHeader className="px-5 pt-5">
              <DialogTitle>Remote access on {environment.host.label}</DialogTitle>
              <DialogDescription>
                Devices you pair here connect straight to {environment.host.label}, so they keep
                working while this computer is off.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="px-5 pb-6">
              <RemoteAccessControls
                api={ensureEnvironmentNativeApi(environment.key).remoteAccess}
              />
            </DialogPanel>
          </>
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}
