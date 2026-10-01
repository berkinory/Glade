import { Schema } from "effect";
import { useState } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { DisclosureRegion } from "~/components/ui/DisclosureRegion";
import { Button } from "~/components/ui/button";
import { SettingsCard, SettingsRow, SettingsSectionShell } from "./SettingsPanelPrimitives";

const STORAGE_KEY = "glade:computer-getting-started:v1";

export function ComputerGettingStarted() {
  const [acknowledged, setAcknowledged] = useLocalStorage(STORAGE_KEY, false, Schema.Boolean);
  const [requestedOpen, setRequestedOpen] = useState(false);
  const open = !acknowledged || requestedOpen;
  const dismiss = () => {
    setRequestedOpen(false);
    if (!acknowledged) setAcknowledged(true);
  };

  return (
    <SettingsSectionShell
      title="Getting started"
      action={
        <Button
          size="xs"
          variant="ghost"
          aria-expanded={open}
          onClick={() => (open ? dismiss() : setRequestedOpen(true))}
        >
          <DisclosureChevron open={open} />
          {open ? "Hide guide" : "Show guide"}
        </Button>
      }
    >
      <DisclosureRegion open={open}>
        <SettingsCard>
          <SettingsRow
            title="Ask for a task"
            description="Type /computer-use followed by your task, for example: “/computer-use open Calculator and calculate 123 × 45.” This enables Computer for that request only. The default setting below can enable it on every turn."
          />
          <SettingsRow
            title="Approve the task"
            description="If asked, approve Computer for the task. Use the permission guide when desktop access is missing. Glade may still ask before consequential actions."
          />
          <SettingsRow
            title="Follow and stop"
            description="Watch the preview while the agent works. Use Stop in the chat to interrupt the task. Closing the preview only hides it."
          />
        </SettingsCard>

        {!acknowledged ? (
          <Button className="mt-3" size="sm" variant="outline" onClick={dismiss}>
            Got it
          </Button>
        ) : null}
      </DisclosureRegion>
    </SettingsSectionShell>
  );
}
