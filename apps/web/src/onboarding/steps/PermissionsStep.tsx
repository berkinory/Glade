import type { ReactNode } from "react";
import { AllowComputerUseRow, PermissionRows } from "~/components/computer/ComputerSettings";
import { KeepAwakeSettingsRow } from "~/components/settings/KeepAwakeSettingsRow";
import { SettingsCard } from "~/components/settings/SettingsPanelPrimitives";
import { isElectron } from "~/env";
import { getNavigatorPlatform, isMacPlatform } from "~/lib/utils";

function PermissionGroup(props: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-ui-sm font-medium text-muted-foreground">{props.title}</h3>
      <SettingsCard>{props.children}</SettingsCard>
    </section>
  );
}

export function PermissionsStep() {
  const isMac = isMacPlatform(getNavigatorPlatform());
  return (
    <div className="flex flex-col gap-5">
      {isElectron ? (
        <PermissionGroup title="Computer Use">
          <AllowComputerUseRow />
          {isMac ? <PermissionRows /> : null}
        </PermissionGroup>
      ) : null}
      <PermissionGroup title="Long-running work">
        <KeepAwakeSettingsRow />
      </PermissionGroup>
    </div>
  );
}
