export interface UiTreeRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface UiTreePoint {
  readonly x: number;
  readonly y: number;
}

export function flattenUiTree<TNode>(
  root: TNode,
  childrenOf: (node: TNode) => readonly TNode[],
): readonly TNode[] {
  const nodes: TNode[] = [];
  const visit = (node: TNode): void => {
    nodes.push(node);
    for (const child of childrenOf(node)) visit(child);
  };
  visit(root);
  return nodes;
}

export function uiTreeActivationPoint(node: {
  readonly frame: UiTreeRect;
  readonly activationPoint?: UiTreePoint | null | undefined;
}): UiTreePoint {
  return (
    node.activationPoint ?? {
      x: node.frame.x + node.frame.width / 2,
      y: node.frame.y + node.frame.height / 2,
    }
  );
}

export interface UiTreeQuery {
  readonly label?: string | undefined;
  readonly role?: string | undefined;
}

export interface UiTreeTargetMatch<TNode> {
  readonly onScreen: boolean;
  readonly node: TNode;
}

export interface UiTreeTargetSpec<TNode> {
  readonly labelOf: (node: TNode) => string;

  readonly matchesRole: (node: TNode, role: string) => boolean;

  readonly matchKey: (label: string) => string;
  // Kept separate from `matchKey` because the two families disagree about how strict promotion to an
  // exact match should be, and folding them together would silently move one of them.
  readonly exactKey: (label: string) => string;
  readonly isOnScreen: (node: TNode) => boolean;
  // Judge ambiguity among the on-screen matches first. A long list that repeats one label down its
  // length is otherwise unresolvable, when in practice the one the human can see is the one meant.
  readonly preferOnScreen: boolean;

  readonly noMatch: (pool: readonly TNode[]) => Error;

  readonly ambiguous: (matches: readonly TNode[]) => Error;
}

// The one node `query` names, or the family's refusal. `pool` is already flattened and already
// scoped — to labelled nodes, to one window, to whatever the family considers eligible — because
// that scope is also what the "nothing matched" refusal has to list, and deriving it twice is how
// the two drift apart.
export function resolveUiTreeTarget<TNode>(input: {
  readonly pool: readonly TNode[];
  readonly query: UiTreeQuery;
  readonly spec: UiTreeTargetSpec<TNode>;
}): UiTreeTargetMatch<TNode> {
  const { pool, query, spec } = input;
  const role = query.role;
  const byRole = role === undefined ? pool : pool.filter((node) => spec.matchesRole(node, role));
  const matches = query.label === undefined ? byRole : matchesForLabel(byRole, query.label, spec);
  if (matches.length === 0) throw spec.noMatch(pool);

  const ranked = spec.preferOnScreen ? preferOnScreenMatches(matches, spec) : matches;
  if (ranked.length > 1) throw spec.ambiguous(ranked);

  const node = ranked[0] as TNode;
  return { onScreen: spec.isOnScreen(node), node };
}

function matchesForLabel<TNode>(
  nodes: readonly TNode[],
  label: string,
  spec: UiTreeTargetSpec<TNode>,
): readonly TNode[] {
  const exact = spec.exactKey(label);
  const exactMatches = nodes.filter((node) => spec.exactKey(spec.labelOf(node)) === exact);
  if (exactMatches.length > 0) return exactMatches;
  const wanted = spec.matchKey(label);
  return nodes.filter((node) => spec.matchKey(spec.labelOf(node)).includes(wanted));
}

function preferOnScreenMatches<TNode>(
  matches: readonly TNode[],
  spec: UiTreeTargetSpec<TNode>,
): readonly TNode[] {
  const visible = matches.filter((node) => spec.isOnScreen(node));
  return visible.length > 0 ? visible : matches;
}
