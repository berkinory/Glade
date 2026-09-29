import type { ComputerUiNode } from "@glade/contracts";

export function describeComputerUiTree(root: ComputerUiNode): string {
  const lines: string[] = [];
  const visit = (node: ComputerUiNode, depth: number): void => {
    const label = node.label ?? node.description ?? "(unlabelled)";
    // The text rendering is what most agents actually read, so a subtree the walk cut short has to say
    // so here too — otherwise a missing control looks like an absent one.
    const truncated = node.truncated === true ? " …(truncated)" : "";
    lines.push(
      `${"  ".repeat(depth)}${node.role}: ${label}${node.value ? ` = ${node.value}` : ""}${truncated}`,
    );
    for (const child of node.children) visit(child, depth + 1);
  };
  visit(root, 0);
  return lines.join("\n");
}
