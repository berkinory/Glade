import type {
  VisualComponentBlock,
  VisualComponentsReply,
} from "@glade/contracts/orchestration/visualComponents";
import { ChartBlock } from "./blocks/ChartBlock";
import { ChecklistBlock } from "./blocks/ChecklistBlock";
import { ChoicesBlock } from "./blocks/ChoicesBlock";
import { StatsBlock } from "./blocks/StatsBlock";
import { TableBlock } from "./blocks/TableBlock";
import { TabsBlock } from "./blocks/TabsBlock";
import type { VisualFollowUp } from "./blocks/visualBlockTypes";

export function VisualComponentsCard({
  reply,
  activityId,
  followUp,
}: {
  readonly reply: VisualComponentsReply;
  readonly activityId: string;
  readonly followUp: VisualFollowUp;
}) {
  const renderBlock = (block: VisualComponentBlock, key: string) => {
    switch (block.type) {
      case "stats":
        return <StatsBlock key={key} block={block} />;
      case "chart":
        return <ChartBlock key={key} block={block} />;
      case "table":
        return <TableBlock key={key} block={block} />;
      case "checklist":
        return <ChecklistBlock key={key} block={block} />;
      case "choices":
        return <ChoicesBlock key={key} block={block} followUp={followUp} />;
      case "tabs":
        return <TabsBlock key={key} block={block} renderBlock={renderBlock} />;
    }
  };
  return (
    <section
      aria-label={reply.title}
      data-visual-reply={activityId}
      className="my-3 flex min-w-0 flex-col gap-4 text-chat"
    >
      {reply.blocks.map((block, index) => renderBlock(block, String(index)))}
    </section>
  );
}
