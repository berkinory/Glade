import type { VisualComponentBlock } from "@glade/contracts/orchestration/visualComponents";

export type VisualBlockOf<Type extends VisualComponentBlock["type"]> = Extract<
  VisualComponentBlock,
  { type: Type }
>;

// The reader's next message, offered only while the reply's turn is the conversation's latest.
export interface VisualFollowUp {
  readonly enabled: boolean;
  readonly onChoose: (message: string) => Promise<boolean>;
}
