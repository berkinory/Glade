import { isRecord } from "@glade/shared/transport/payloadValues";

export const countSchemaKeyOccurrences = (node: unknown, key: string): number => {
  if (Array.isArray(node)) {
    return node.reduce<number>((total, child) => total + countSchemaKeyOccurrences(child, key), 0);
  }
  if (!isRecord(node)) return 0;
  return Object.entries(node).reduce<number>(
    (total, [childKey, child]) =>
      total + (childKey === key ? 1 : 0) + countSchemaKeyOccurrences(child, key),
    0,
  );
};
