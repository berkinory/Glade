import { pluralize } from "@glade/shared/text/text";

import { formatFileCommentLabel } from "~/lib/fileComments";
import { MessageCircleIcon } from "~/lib/icons";
import { AttachmentSummaryChip } from "./AttachmentSummaryChip";

interface FileCommentChipEntry {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
}

interface FileCommentsSummaryChipProps {
  comments: ReadonlyArray<FileCommentChipEntry>;
  onRemove?: (() => void) | undefined;
}

function commentCountLabel(count: number): string {
  return `${count} ${pluralize(count, "comment")}`;
}

export function FileCommentsSummaryChip(props: FileCommentsSummaryChipProps) {
  if (props.comments.length === 0) {
    return null;
  }

  return (
    <AttachmentSummaryChip
      icon={MessageCircleIcon}
      label={commentCountLabel(props.comments.length)}
      removeLabel="Remove comments"
      onRemove={props.onRemove}
      tooltip={props.comments.map((comment, index) => (
        <div key={`${formatFileCommentLabel(comment)}:${index}`} className="space-y-0.5">
          <p className="text-ui-sm font-medium text-muted-foreground">
            {formatFileCommentLabel(comment)}
          </p>
          <p className="text-ui leading-relaxed">{comment.text}</p>
        </div>
      ))}
    />
  );
}
