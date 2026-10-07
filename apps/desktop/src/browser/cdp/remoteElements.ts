import type { CdpSession } from "./cdpSession";

// Backend node ids of the elements in a page-side array, by index; null where an entry is not a
// node.
export async function elementIds(
  cdp: CdpSession,
  sessionId: string | undefined,
  arrayObjectId: string,
): Promise<Array<number | null>> {
  const { result } = await cdp.send<{
    result: ReadonlyArray<{ name: string; value?: { objectId?: string; subtype?: string } }>;
  }>("Runtime.getProperties", { objectId: arrayObjectId, ownProperties: true }, sessionId);
  const ids: Array<number | null> = [];
  for (const property of result) {
    const index = Number(property.name);
    if (!Number.isInteger(index) || index < 0) continue;
    const objectId = property.value?.subtype === "node" ? property.value.objectId : undefined;
    ids[index] = objectId
      ? (
          await cdp.send<{ node: { backendNodeId: number } }>(
            "DOM.describeNode",
            { objectId },
            sessionId,
          )
        ).node.backendNodeId
      : null;
  }
  return ids;
}
