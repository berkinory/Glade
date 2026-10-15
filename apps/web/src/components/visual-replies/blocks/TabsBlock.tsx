import type { ReactNode } from "react";
import { Tabs } from "@base-ui/react/tabs";
import type { VisualComponentLeafBlock } from "@glade/contracts/orchestration/visualComponents";
import type { VisualBlockOf } from "./visualBlockTypes";

export function TabsBlock({
  block,
  renderBlock,
}: {
  readonly block: VisualBlockOf<"tabs">;
  readonly renderBlock: (block: VisualComponentLeafBlock, key: string) => ReactNode;
}) {
  return (
    <Tabs.Root defaultValue={0} className="flex min-w-0 flex-col gap-3">
      <Tabs.List className="flex flex-wrap gap-1 border-b border-border">
        {block.tabs.map((tab, index) => (
          <Tabs.Tab
            key={`${tab.label}:${index}`}
            value={index}
            className="-mb-px border-b-2 border-transparent px-2.5 py-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-active:border-foreground data-active:text-foreground"
          >
            {tab.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {block.tabs.map((tab, index) => (
        // Hidden panels stay mounted so ticks and sorting survive switching tabs.
        <Tabs.Panel
          key={`${tab.label}:${index}`}
          value={index}
          keepMounted
          className="flex min-w-0 flex-col gap-4 data-hidden:hidden"
        >
          {tab.blocks.map((child, childIndex) => renderBlock(child, `${index}:${childIndex}`))}
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  );
}
