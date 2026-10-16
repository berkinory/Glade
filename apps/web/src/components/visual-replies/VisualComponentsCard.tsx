import { useState } from "react";
import type {
  VisualComponentBlock,
  VisualComponentsReply,
} from "@glade/contracts/orchestration/visualComponents";
import { defaultInputScope, visualComponentInputs } from "@glade/shared/visualComponentScope";
import { ChartBlock } from "./blocks/ChartBlock";
import { ChecklistBlock } from "./blocks/ChecklistBlock";
import { ChoicesBlock } from "./blocks/ChoicesBlock";
import { InputsBlock } from "./blocks/InputsBlock";
import { StatsBlock } from "./blocks/StatsBlock";
import { DataTable } from "../DataTable";
import { TabsBlock } from "./blocks/TabsBlock";
import type { VisualFollowUp } from "./blocks/visualBlockTypes";
import { resolveVisualBlock } from "./VisualComponentsCard.logic";

export function VisualComponentsCard({
  reply,
  activityId,
  followUp,
}: {
  readonly reply: VisualComponentsReply;
  readonly activityId: string;
  readonly followUp: VisualFollowUp;
}) {
  // Inputs are shared by every block in the reply, including those inside tabs.
  const [scope, setScope] = useState(() => defaultInputScope(visualComponentInputs(reply.blocks)));
  const changeInput = (id: string, value: number) =>
    setScope((current) => ({ ...current, [id]: value }));
  const renderBlock = (block: VisualComponentBlock, key: string) => {
    if (block.type === "tabs")
      return <TabsBlock key={key} block={block} renderBlock={renderBlock} />;
    const resolved = resolveVisualBlock(block, scope);
    switch (resolved.type) {
      case "inputs":
        return <InputsBlock key={key} block={resolved} scope={scope} onChange={changeInput} />;
      case "stats":
        return <StatsBlock key={key} block={resolved} />;
      case "chart":
        return <ChartBlock key={key} block={resolved} />;
      case "table":
        return (
          <DataTable
            key={key}
            columns={resolved.columns}
            rows={resolved.rows}
            caption={resolved.title}
            text="chat"
            className="max-h-[32rem] rounded-lg border border-border"
          />
        );
      case "checklist":
        return <ChecklistBlock key={key} block={resolved} />;
      case "choices":
        return <ChoicesBlock key={key} block={resolved} followUp={followUp} />;
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
