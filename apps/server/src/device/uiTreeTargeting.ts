import type { DeviceUiNode, DeviceUiPoint } from "@glade/contracts";
import {
  flattenUiTree,
  resolveUiTreeTarget,
  uiTreeActivationPoint,
  type UiTreeTargetSpec,
} from "@glade/shared/uiTreeTargeting";

export interface DeviceUiTarget {
  readonly label: string;
  readonly role?: string | undefined;
}

export interface DeviceUiTargetMatch {
  readonly point: DeviceUiPoint;
  readonly node: DeviceUiNode;

  readonly onScreen: boolean;
}

export class DeviceUiTargetError extends Error {
  readonly _tag = "DeviceUiTargetError";

  readonly candidates: readonly string[];
  // Distinguished from an ambiguous or off-screen match because long lists are virtualized: UIKit
  // only materializes the rows near the viewport, so a row further down is genuinely absent from the
  // tree until scrolling reaches it. A scroll loop must keep looking; an ambiguity must not be
  // retried.
  readonly notFound: boolean;

  constructor(message: string, candidates: readonly string[] = [], notFound = false) {
    const listed =
      candidates.length === 0
        ? message
        : `${message} Elements on screen: ${candidates.join("; ")}.`;
    super(listed);
    this.name = "DeviceUiTargetError";
    this.candidates = candidates;
    this.notFound = notFound;
  }
}

const MAX_REPORTED_CANDIDATES = 12;

const childrenOf = (node: DeviceUiNode): readonly DeviceUiNode[] => node.children;

function labelledNodes(root: DeviceUiNode): readonly DeviceUiNode[] {
  return flattenUiTree(root, childrenOf).filter(
    (node) => node.label !== null && node.label.length > 0,
  );
}

export function visibleLabels(root: DeviceUiNode): string[] {
  return labelledNodes(root).map((node) => node.label as string);
}

function tapPointForNode(node: DeviceUiNode): DeviceUiPoint {
  return uiTreeActivationPoint(node);
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function matchesRole(node: DeviceUiNode, role: string): boolean {
  const wanted = normalize(role);
  return (
    normalize(node.role) === wanted || (node.subrole !== null && normalize(node.subrole) === wanted)
  );
}

function isOnScreen(node: DeviceUiNode, root: DeviceUiNode): boolean {
  const point = tapPointForNode(node);
  return (
    point.x >= root.frame.x &&
    point.x <= root.frame.x + root.frame.width &&
    point.y >= root.frame.y &&
    point.y <= root.frame.y + root.frame.height
  );
}

function describe(node: DeviceUiNode): string {
  const role = node.subrole === null ? node.role : `${node.role}/${node.subrole}`;
  const value = node.value === null ? "" : ` value=${JSON.stringify(node.value)}`;
  return `${role} ${JSON.stringify(node.label ?? "")}${value}`;
}

// Exact label matches win outright: a screen with both "Developer" and "Developer Mode" must not be
// ambiguous when the caller said "Developer". Ambiguity is judged among visible matches first. A
// list that repeats a label down its length would otherwise be unresolvable, when in practice the
// one on screen is the one meant.
export function findTarget(root: DeviceUiNode, target: DeviceUiTarget): DeviceUiTargetMatch {
  if (normalize(target.label).length === 0) {
    throw new DeviceUiTargetError("A tap target needs a non-empty label.");
  }
  const match = resolveUiTreeTarget({
    pool: labelledNodes(root),
    query: { label: target.label, role: target.role },
    spec: deviceTargetSpec(root, target),
  });
  return { point: tapPointForNode(match.node), node: match.node, onScreen: match.onScreen };
}

function deviceTargetSpec(
  root: DeviceUiNode,
  target: DeviceUiTarget,
): UiTreeTargetSpec<DeviceUiNode> {
  return {
    labelOf: (node) => node.label ?? "",
    matchesRole,
    matchKey: normalize,
    exactKey: normalize,
    isOnScreen: (node) => isOnScreen(node, root),
    preferOnScreen: true,
    noMatch: (pool) => {
      const roleNote = target.role === undefined ? "" : ` with role ${JSON.stringify(target.role)}`;
      return new DeviceUiTargetError(
        `No element labelled ${JSON.stringify(target.label)}${roleNote} is in the accessibility tree. ` +
          `It may belong to a screen you have not opened yet; call device_describe_ui and use a label listed there.`,
        pool.slice(0, MAX_REPORTED_CANDIDATES).map(describe),
        true,
      );
    },
    ambiguous: (matches) =>
      new DeviceUiTargetError(
        `${matches.length} elements match ${JSON.stringify(target.label)}. ` +
          `Pass role to narrow it, or tap explicit coordinates from device_describe_ui.`,
        matches.slice(0, MAX_REPORTED_CANDIDATES).map(describe),
      ),
  };
}

const SAFE_BAND_INSET_FRACTION = 0.12;

const SCROLL_INCREMENT_FRACTION = 0.6;

export const SCROLL_SWIPE_DURATION_MS = 400;

export interface DeviceScrollStep {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly durationMs: number;
}

export function planScrollStep(node: DeviceUiNode, root: DeviceUiNode): DeviceScrollStep | null {
  const inset = root.frame.height * SAFE_BAND_INSET_FRACTION;
  const bandTop = root.frame.y + inset;
  const bandBottom = root.frame.y + root.frame.height - inset;
  const centre = node.frame.y + node.frame.height / 2;

  if (centre >= bandTop && centre <= bandBottom) return null;

  const increment = root.frame.height * SCROLL_INCREMENT_FRACTION;
  const midX = root.frame.x + root.frame.width / 2;
  const screenCentre = root.frame.y + root.frame.height / 2;

  const distance = Math.min(increment, Math.abs(centre - screenCentre));
  const from = centre > bandBottom ? screenCentre + distance / 2 : screenCentre - distance / 2;
  const to = centre > bandBottom ? from - distance : from + distance;

  return { fromX: midX, fromY: from, toX: midX, toY: to, durationMs: SCROLL_SWIPE_DURATION_MS };
}

export type DeviceTapRequest =
  | { readonly kind: "point"; readonly x: number; readonly y: number }
  | { readonly kind: "element"; readonly target: DeviceUiTarget };

export function readTapRequest(input: {
  readonly x?: number | undefined;
  readonly y?: number | undefined;
  readonly label?: string | undefined;
  readonly role?: string | undefined;
}): DeviceTapRequest {
  const hasPoint = input.x !== undefined && input.y !== undefined;
  if (input.label !== undefined) {
    if (hasPoint) {
      throw new DeviceUiTargetError(
        "A tap takes either label (with optional role) or x and y, not both. " +
          "Pass label alone to let Glade resolve the element's own tap point.",
      );
    }
    return { kind: "element", target: { label: input.label, role: input.role } };
  }
  if (!hasPoint) {
    throw new DeviceUiTargetError(
      "A tap needs either label (with optional role) or both x and y. " +
        "Prefer label: Glade then resolves the element's own tap point from the accessibility tree.",
    );
  }
  return { kind: "point", x: input.x as number, y: input.y as number };
}
