import { useEffect } from "react";

import { resolveAssistantDeliveryMode, useAppSettings } from "../appSettings";
import { queuedComposerDrain } from "../lib/queuedComposerDrain";

export function QueuedComposerDrainCoordinator() {
  const { settings } = useAppSettings();
  const assistantDeliveryMode = resolveAssistantDeliveryMode(settings);

  useEffect(() => {
    return queuedComposerDrain.startQueuedComposerDrainWatcher();
  }, []);

  useEffect(() => {
    queuedComposerDrain.setQueuedComposerDrainAssistantDeliveryMode(assistantDeliveryMode);
  }, [assistantDeliveryMode]);

  return null;
}
