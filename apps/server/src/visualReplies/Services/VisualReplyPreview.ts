import { ServiceMap, type Effect } from "effect";
import type { VisualReplyError } from "../visualReplySource";

export interface VisualReplyPreviewShape {
  readonly capture: (input: {
    readonly html: string;
    readonly width: number;
    readonly height: number;
  }) => Effect.Effect<
    {
      readonly png: Uint8Array;
      readonly contentHeight: number;
      readonly console: readonly string[];
    },
    VisualReplyError
  >;
}

export class VisualReplyPreview extends ServiceMap.Service<
  VisualReplyPreview,
  VisualReplyPreviewShape
>()("glade/visualReplies/Services/VisualReplyPreview") {}
