import { MicIcon } from "~/lib/icons";
import { Spinner } from "~/components/ui/spinner";
import { Button } from "../ui/button";
export const ComposerVoiceButton = function ComposerVoiceButton(props: {
  disabled?: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  durationLabel: string;
  onClick: () => void;
}) {
  const label = props.isTranscribing
    ? "Transcribing voice note"
    : props.isRecording
      ? `Stop voice note (${props.durationLabel})`
      : "Record voice note";
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className="shrink-0 rounded-md"
      disabled={props.disabled || props.isTranscribing}
      aria-label={label}
      title={label}
      onClick={props.onClick}
    >
      {props.isTranscribing ? (
        <Spinner variant="voice" aria-hidden="true" className="size-4 text-primary" />
      ) : (
        <MicIcon aria-hidden="true" className="size-4 text-primary" />
      )}
    </Button>
  );
};
