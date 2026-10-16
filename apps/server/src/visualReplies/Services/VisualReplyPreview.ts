import { ServiceMap, type Effect } from "effect";
import type { VisualReplyError } from "../visualReplySource";

interface VisualReplyMeasurement {
  readonly heights: readonly (readonly [number, number])[];
  /** Uncaught script errors while the page loaded at any measured width. */
  readonly errors: readonly string[];
  readonly hasContent: boolean;
}

export interface VisualReplyPreviewShape {
  /** Undefined when the preview browser is not installed or measurement failed. */
  readonly measure: (html: string) => Effect.Effect<VisualReplyMeasurement | undefined>;
  readonly capture: (input: {
    readonly html: string;
    readonly width: number;
    readonly height: number;
    readonly appearance?: "light" | "dark";
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
