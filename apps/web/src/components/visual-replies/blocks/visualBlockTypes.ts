import type {
  VisualComponentBlock,
  VisualComponentLeafBlock,
} from "@glade/contracts/orchestration/visualComponents";

export type VisualBlockOf<Type extends VisualComponentBlock["type"]> = Extract<
  VisualComponentBlock,
  { type: Type }
>;

type Resolved<Block> = Block extends { type: "stats"; items: readonly (infer Item)[] }
  ? Omit<Block, "items"> & {
      readonly items: readonly (Omit<Item, "value"> & { readonly value: string | number })[];
    }
  : Block extends { type: "chart" }
    ? Omit<Block, "series"> & {
        readonly series: readonly { readonly name: string; readonly values: readonly number[] }[];
      }
    : Block;

// A leaf block with its formulas evaluated for the reader's current inputs.
export type ResolvedVisualLeafBlock = Resolved<VisualComponentLeafBlock>;
export type ResolvedBlockOf<Type extends VisualComponentLeafBlock["type"]> = Extract<
  ResolvedVisualLeafBlock,
  { type: Type }
>;

// The reader's next message, offered only while the reply's turn is the conversation's latest.
export interface VisualFollowUp {
  readonly enabled: boolean;
  readonly onChoose: (message: string) => Promise<boolean>;
}
