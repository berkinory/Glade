import type { McpCatalog as McpCatalogDocument } from "@glade/contracts/server/mcpCatalog";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

export interface McpCatalogShape {
  // The newest verified catalog: the bundled snapshot until useglade.dev publishes a later one.
  readonly current: Effect.Effect<McpCatalogDocument>;
}

export class McpCatalog extends ServiceMap.Service<McpCatalog, McpCatalogShape>()(
  "glade/mcpCatalog/Services/McpCatalog",
) {}
