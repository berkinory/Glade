// FILE: TranscriptSelectionActionLayer.tsx
// Purpose: Renders the transcript selection floating action from controller state.
// Layer: Chat transcript interaction UI

import type { ThreadEnvironmentMode } from "@glade/contracts";
import { useState } from "react";
import { createPortal } from "react-dom";

import type { TranscriptAssistantSelection } from "./chatSelectionActions";
import { SelectionNewChatComposer } from "./SelectionNewChatComposer";

import { type PendingTranscriptSelectionAction } from "./useTranscriptAssistantSelectionAction";
import { TranscriptSelectionAction } from "./TranscriptSelectionAction";

interface TranscriptSelectionActionLayerProps {
  action: PendingTranscriptSelectionAction | null;
  defaultEnvMode: ThreadEnvironmentMode;
  canUseWorktree: boolean;
  onDismiss: () => void;
  onAddToChat: () => void;
  onNewChat: (
    selection: TranscriptAssistantSelection,
    prompt: string,
    envMode: ThreadEnvironmentMode,
    intent: "send" | "compose",
  ) => Promise<void>;
}

export function TranscriptSelectionActionLayer(props: TranscriptSelectionActionLayerProps) {
  const [composerAction, setComposerAction] = useState<PendingTranscriptSelectionAction | null>(
    null,
  );

  if (composerAction) {
    return createPortal(
      <SelectionNewChatComposer
        action={composerAction}
        defaultEnvMode={props.defaultEnvMode}
        canUseWorktree={props.canUseWorktree}
        onSend={(prompt, envMode) =>
          props.onNewChat(composerAction.selection, prompt, envMode, "send")
        }
        onOpenInChat={(prompt, envMode) =>
          props.onNewChat(composerAction.selection, prompt, envMode, "compose")
        }
        onClose={() => setComposerAction(null)}
      />,
      document.body,
    );
  }
  const action = props.action;
  if (!action) return null;

  return createPortal(
    <TranscriptSelectionAction
      left={action.left}
      top={action.top}
      placement={action.placement}
      onAddToChat={props.onAddToChat}
      onAddToNewChat={() => {
        setComposerAction(action);
        props.onDismiss();
        window.getSelection()?.removeAllRanges();
      }}
    />,
    document.body,
  );
}
