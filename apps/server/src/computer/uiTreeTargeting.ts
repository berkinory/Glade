import type {
  ComputerPoint,
  ComputerRect,
  ComputerScreenSize,
  ComputerTarget,
  ComputerUiNode,
} from "@glade/contracts/computer/computer";
import type { ComputerSpaceErrorCode } from "@glade/contracts/computer/computerSpaces";
import {
  flattenUiTree,
  resolveUiTreeTarget,
  uiTreeActivationPoint,
  type UiTreeTargetSpec,
} from "@glade/shared/uiTreeTargeting";
import { clampTextToLength } from "./utf8Truncation.ts";
import { retainComputerElementRef } from "./computerElementIdentity.ts";

export interface ComputerTargetCandidate {
  readonly label: string;
  readonly role: string;
  readonly windowId: string | null;
  readonly onScreen: boolean;
  readonly frame: ComputerRect;
}

export interface ComputerTargetMatch {
  readonly point: ComputerPoint;
  readonly node: ComputerUiNode;
}

export type ComputerTargetErrorCode =
  | ComputerSpaceErrorCode
  | "computer_target_invalid"
  | "computer_target_not_found"
  | "computer_target_ambiguous"
  | "computer_target_offscreen"
  | "computer_target_occluded"
  | "computer_target_refused"
  // The target belongs to a denylisted surface — a password manager or OS security UI — and the
  // access was refused before it could dispatch or disclose anything.
  | "computer_denylist_refused";

const MAX_REPORTED_CANDIDATES = 16;

export class ComputerTargetError extends Error {
  readonly _tag = "ComputerTargetError";
  readonly code: ComputerTargetErrorCode;
  readonly candidates: readonly ComputerTargetCandidate[];
  readonly notFound: boolean;

  readonly unresolvedTextControl: boolean;

  constructor(input: {
    readonly code: ComputerTargetErrorCode;
    readonly message: string;
    readonly candidates?: readonly ComputerTargetCandidate[];
    readonly notFound?: boolean;
    readonly unresolvedTextControl?: boolean;
  }) {
    const candidates = input.candidates ?? [];

    super(messageWithCandidates(input.message, candidates));
    this.name = "ComputerTargetError";
    this.code = input.code;
    this.candidates = candidates;
    this.notFound = input.notFound ?? input.code === "computer_target_not_found";
    this.unresolvedTextControl = input.unresolvedTextControl ?? false;
  }
}

export function resolveComputerPoint(
  target: ComputerTarget,
  screenSize: ComputerScreenSize,
): ComputerPoint {
  const hasX = typeof target.x === "number";
  const hasY = typeof target.y === "number";
  if (hasX !== hasY) {
    throw new ComputerTargetError({
      code: "computer_target_invalid",
      message: "Computer coordinate targets must include both x and y.",
    });
  }
  if (!hasX || !hasY) {
    throw new ComputerTargetError({
      code: "computer_target_invalid",
      message: "Computer actions require x/y coordinates or a labelled target.",
    });
  }
  const point = { x: target.x, y: target.y } as ComputerPoint;
  if (point.x < 0 || point.y < 0 || point.x >= screenSize.width || point.y >= screenSize.height) {
    throw new ComputerTargetError({
      code: "computer_target_offscreen",
      message: `Computer target (${point.x}, ${point.y}) is outside the ${screenSize.width}x${screenSize.height} screen.`,
      candidates: [],
    });
  }
  return point;
}

export function resolveComputerSemanticTarget(
  root: ComputerUiNode,
  target: ComputerTarget,
  allowOffscreen = false,
): ComputerTargetMatch {
  if (target.refOrdinal !== undefined && target.label !== undefined) {
    return resolveComputerOrdinalTarget(root, target, target.refOrdinal, allowOffscreen);
  }
  const match = resolveUiTreeTarget({
    pool: flattenUiTree(root, childrenOf).filter((node) => matchesWindow(node, target.windowId)),
    query: { label: target.label, role: target.role },
    spec: computerTargetSpec(target),
  });
  if (!match.onScreen && !allowOffscreen) {
    throw new ComputerTargetError({
      code: "computer_target_offscreen",
      message: `Computer target ${describeTarget(target)} is off-screen; refusing to guess a click.`,
      candidates: candidateDescriptions([match.node]),
    });
  }
  return { node: match.node, point: activationPointForNode(match.node) };
}

function resolveComputerOrdinalTarget(
  root: ComputerUiNode,
  target: ComputerTarget,
  ordinal: number,
  allowOffscreen: boolean,
): ComputerTargetMatch {
  const spec = computerTargetSpec(target);
  const pool = flattenUiTree(root, childrenOf).filter((node) =>
    matchesWindow(node, target.windowId),
  );
  const exact = spec.exactKey(target.label!);
  const matches = pool.filter(
    (node) =>
      (target.role === undefined || spec.matchesRole(node, target.role)) &&
      spec.exactKey(spec.labelOf(node)) === exact,
  );
  const onScreen = matches.filter((node) => spec.isOnScreen(node));
  const ordered = onScreen.length > 0 ? onScreen : matches;
  let node: ComputerUiNode;
  if (ordered.length > ordinal) {
    node = ordered[ordinal]!;
  } else if (ordered.length === 0) {
    throw spec.noMatch(pool);
  } else {
    throw new ComputerTargetError({
      code: "computer_target_not_found",
      message: `Computer target ${describeTarget(target)} no longer exists at its observed duplicate position. Observe again with computer_get_state before acting.`,
      candidates: candidateDescriptions(ordered),
      notFound: true,
    });
  }
  if (!spec.isOnScreen(node) && !allowOffscreen) {
    throw new ComputerTargetError({
      code: "computer_target_offscreen",
      message: `Computer target ${describeTarget(target)} is off-screen; refusing to guess a click.`,
      candidates: candidateDescriptions([node]),
    });
  }
  return { node, point: activationPointForNode(node) };
}

const SEMANTIC_TEXT_ROLES = new Set([
  "AXTextField",
  "AXTextArea",
  "AXSearchField",
  "AXSecureTextField",
  "entry",
  "text field",
  "text-field",
  "search field",
  "text area",
  "textarea",
]);

export function resolveComputerUniqueTextTarget(
  root: ComputerUiNode,
  windowId: string,
  allowOffscreen = false,
): ComputerTargetMatch {
  const candidates = flattenUiTree(root, childrenOf).filter(
    (node) =>
      node.windowId === windowId &&
      (allowOffscreen || node.onScreen) &&
      node.editable !== false &&
      (node.editable === true || SEMANTIC_TEXT_ROLES.has(node.role)),
  );
  if (candidates.length === 0) {
    throw new ComputerTargetError({
      code: "computer_target_not_found",
      message: `Window ${JSON.stringify(windowId)} has no ${allowOffscreen ? "" : "visible "}writable text control. Observe it and pass the exact label and role.`,
      candidates: candidateDescriptions(
        flattenUiTree(root, childrenOf).filter((node) => node.windowId === windowId),
      ),
      notFound: true,
      unresolvedTextControl: true,
    });
  }
  if (candidates.length > 1) {
    throw new ComputerTargetError({
      code: "computer_target_ambiguous",
      message: `Window ${JSON.stringify(windowId)} has more than one ${allowOffscreen ? "" : "visible "}writable text control. Pass the exact label and role.`,
      candidates: candidateDescriptions(candidates),
      unresolvedTextControl: true,
    });
  }
  const node = candidates[0]!;
  return { node, point: activationPointForNode(node) };
}

export function resolveComputerWindowTarget(
  root: ComputerUiNode,
  windowId: string,
): ComputerTargetMatch | undefined {
  const node = flattenUiTree(root, childrenOf).find((candidate) => candidate.windowId === windowId);
  if (node === undefined) return undefined;
  if (!node.onScreen) {
    throw new ComputerTargetError({
      code: "computer_target_offscreen",
      message: `Computer window ${JSON.stringify(windowId)} is off-screen; refusing to guess a scroll point.`,
      candidates: candidateDescriptions([node]),
    });
  }
  return { node, point: activationPointForNode(node) };
}

// Three of these deliberately differ from the iOS family rather than having drifted: a role is
// compared verbatim because AT-SPI role names are a fixed vocabulary rather than free text,
// `onScreen` is trusted because the perception source computed it against the real workspace rect,
// and labels keep their surrounding space because nothing trims a label arriving over MCP and a
// match that ignored the difference would act on a control the caller did not name.
function computerTargetSpec(target: ComputerTarget): UiTreeTargetSpec<ComputerUiNode> {
  return {
    labelOf: matchableLabel,
    matchesRole: (node, role) => node.role === role,
    matchKey: (label) => normalizeLabelSpaces(label).toLocaleLowerCase(),

    exactKey: normalizeLabelSpaces,
    isOnScreen: (node) => node.onScreen,
    preferOnScreen: false,
    noMatch: (pool) =>
      new ComputerTargetError({
        code: "computer_target_not_found",
        message: `No visible computer target matched ${describeTarget(target)}.`,
        candidates: candidateDescriptions(pool),
        notFound: true,
      }),
    ambiguous: (matches) =>
      new ComputerTargetError({
        code: "computer_target_ambiguous",
        message: `Computer target ${describeTarget(target)} matched more than one control.`,
        candidates: candidateDescriptions(matches),
      }),
  };
}

export function activationPointForNode(node: ComputerUiNode): ComputerPoint {
  return uiTreeActivationPoint(node);
}

function candidateDescriptions(
  nodes: readonly ComputerUiNode[],
): readonly ComputerTargetCandidate[] {
  return nodes.slice(0, MAX_REPORTED_CANDIDATES).map((node) => ({
    label: node.label ?? node.description ?? "(unlabelled)",
    role: node.role,
    windowId: node.windowId,
    onScreen: node.onScreen,
    frame: node.frame,
  }));
}

export function computerTargetCandidates(root: ComputerUiNode): readonly ComputerTargetCandidate[] {
  return candidateDescriptions(flattenUiTree(root, childrenOf));
}

const ACTIONABLE_ROLES = new Set([
  "AXButton",
  "AXCheckBox",
  "AXRadioButton",
  "AXPopUpButton",
  "AXComboBox",
  "AXTextField",
  "AXTextArea",
  "AXSearchField",
  "AXSecureTextField",
  "AXLink",
  "AXMenuBarItem",
  "AXMenuItem",
  "AXSlider",
  "AXIncrementor",
  "AXTab",
  "AXSwitch",

  "push button",
  "button",
  "toggle button",

  "entry",
  "text field",
  "text-field",
  "search field",

  "check box",
  "radio button",
  "combo box",
  "list box",
  "switch",
  "slider",
  "spin button",

  "link",
  "page tab",
  "menu item",
  "check menu item",
  "radio menu item",
]);

const ELEMENT_DIGEST_MAX_LENGTH = 60;

const ELEMENT_TEXT_MAX_LENGTH = 80;

export interface ComputerActionableElement {
  readonly ref: number;
  readonly role: string;
  readonly label: string;
  // Current contents of an editable control, truncated. Absent otherwise.
  readonly value?: string;
  readonly windowId: string | null;
}

// What a `ref` actually resolves to — kept beside the display items because their labels are
// truncated for the wire while targeting needs the element's full identity.
export interface ComputerActionableElementRef {
  readonly label: string;
  readonly role: string;
  readonly windowId: string | null;

  readonly ordinal: number;
}

export interface ComputerActionableElements {
  readonly items: readonly ComputerActionableElement[];

  readonly refIndex: readonly ComputerActionableElementRef[];

  readonly complete: boolean;
  readonly sourceIncomplete: boolean;

  readonly omitted: number;
}

export interface ComputerActionableElementFilter {
  readonly windowId?: string | undefined;

  readonly labelContains?: string | undefined;
}

// Only labeled elements are listed, because targeting is by label: an unlabeled control cannot be
// addressed semantically, and listing it would push the caller back toward coordinates. Off-screen
// elements are excluded too — semantic resolution refuses off-screen targets, so naming them would
// invite a refused action; scrolling brings them on screen and they appear in the next digest.
export function actionableElements(
  root: ComputerUiNode,
  filter: ComputerActionableElementFilter = {},
): ComputerActionableElements {
  const items: ComputerActionableElement[] = [];
  const refIndex: ComputerActionableElementRef[] = [];

  const ordinals = new Map<string, number>();
  const wanted =
    filter.labelContains === undefined
      ? undefined
      : normalizeLabelSpaces(filter.labelContains).toLocaleLowerCase();
  let omitted = 0;
  let sourceIncomplete = false;
  const walk = (node: ComputerUiNode): void => {
    if (node.truncated) sourceIncomplete = true;
    const label = matchableLabel(node);
    const collectible =
      ACTIONABLE_ROLES.has(node.role) &&
      node.onScreen &&
      node.windowId !== null &&
      label !== "" &&
      (filter.windowId === undefined || node.windowId === filter.windowId) &&
      (wanted === undefined || normalizeLabelSpaces(label).toLocaleLowerCase().includes(wanted));
    if (collectible) {
      const identity = `${node.windowId}${node.role}${normalizeLabelSpaces(label)}`;
      const ordinal = ordinals.get(identity) ?? 0;
      ordinals.set(identity, ordinal + 1);
      if (items.length < ELEMENT_DIGEST_MAX_LENGTH) {
        refIndex.push(
          retainComputerElementRef(
            { label, role: node.role, windowId: node.windowId, ordinal },
            node,
          ),
        );
        items.push({
          ref: items.length,
          role: node.role,
          label: clampTextToLength(label, ELEMENT_TEXT_MAX_LENGTH),

          ...(node.value !== null && node.value !== undefined
            ? { value: clampTextToLength(node.value, 40) }
            : {}),
          windowId: node.windowId,
        });
      } else {
        omitted += 1;
      }
    }

    for (const child of node.children) walk(child);
  };
  walk(root);
  return {
    items,
    refIndex,
    complete: omitted === 0 && !sourceIncomplete,
    omitted,
    sourceIncomplete,
  };
}

// What changed between two element digests, keyed on the element's identity — window, role, and
// label — rather than its position, so a list that reorders does not read as everything leaving and
// arriving. Identity is a multiset, not a key: duplicate labels are kept on purpose (a repeated
// "Save" is real ambiguity), so each identity maps to a list of values paired by index. A pair
// whose value moved reports `changed`; identities or values with no counterpart report `added` or
// `removed`. What it cannot see: an element that moved but kept its label, role and value diffs
// clean, because the digest carries no frame.
export interface ComputerActionableElementsDiff {
  readonly added: readonly ComputerActionableElement[];
  readonly removed: readonly ComputerActionableElement[];
  readonly changed: readonly {
    readonly ref: number;
    readonly role: string;
    readonly label: string;
    readonly windowId: string | null;

    readonly was?: string;
    readonly value?: string;
  }[];
}

export function diffActionableElements(
  before: readonly ComputerActionableElement[],
  after: readonly ComputerActionableElement[],
): ComputerActionableElementsDiff {
  const identity = (item: ComputerActionableElement): string =>
    JSON.stringify([item.windowId ?? null, item.role, item.label]);
  const group = (
    items: readonly ComputerActionableElement[],
  ): Map<string, ComputerActionableElement[]> => {
    const grouped = new Map<string, ComputerActionableElement[]>();
    for (const item of items) {
      const key = identity(item);
      const bucket = grouped.get(key);
      if (bucket) bucket.push(item);
      else grouped.set(key, [item]);
    }
    return grouped;
  };
  const oldGroups = group(before);
  const newGroups = group(after);
  const added: ComputerActionableElement[] = [];
  const removed: ComputerActionableElement[] = [];
  const changed: ComputerActionableElementsDiff["changed"][number][] = [];
  for (const [key, previous] of oldGroups) {
    const current = newGroups.get(key);
    if (current === undefined) {
      removed.push(...previous);
      continue;
    }
    const overlap = Math.min(previous.length, current.length);
    for (let index = 0; index < overlap; index += 1) {
      if (previous[index]!.value !== current[index]!.value) {
        const item = current[index]!;
        changed.push({
          ref: item.ref,
          role: item.role,
          label: item.label,
          windowId: item.windowId,
          ...(previous[index]!.value !== undefined ? { was: previous[index]!.value } : {}),
          ...(item.value !== undefined ? { value: item.value } : {}),
        });
      }
    }
    removed.push(...previous.slice(overlap));
    added.push(...current.slice(overlap));
    newGroups.delete(key);
  }
  for (const current of newGroups.values()) added.push(...current);
  return { added, removed, changed };
}

function describeTarget(target: ComputerTarget): string {
  const parts = [
    target.label ? `label=${JSON.stringify(target.label)}` : null,
    target.role ? `role=${JSON.stringify(target.role)}` : null,
    target.windowId ? `window=${JSON.stringify(target.windowId)}` : null,
    target.refOrdinal !== undefined ? `duplicate ${target.refOrdinal + 1}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(", ") : "the supplied coordinates";
}

const childrenOf = (node: ComputerUiNode): readonly ComputerUiNode[] => node.children;

function matchableLabel(node: ComputerUiNode): string {
  return node.label ?? node.description ?? "";
}

export function normalizeLabelSpaces(label: string): string {
  return label.replace(/[\u00a0\u2007\u202f]/g, " ");
}

function matchesWindow(node: ComputerUiNode, windowId: string | undefined): boolean {
  return windowId === undefined || node.windowId === windowId;
}

function describeCandidate(candidate: ComputerTargetCandidate): string {
  const window =
    candidate.windowId === null ? "" : ` in window ${JSON.stringify(candidate.windowId)}`;
  return `${candidate.role} ${JSON.stringify(candidate.label)}${window}`;
}

function messageWithCandidates(
  message: string,
  candidates: readonly ComputerTargetCandidate[],
): string {
  if (candidates.length === 0) return message;
  return `${message} Controls in the accessibility tree: ${candidates.map(describeCandidate).join("; ")}.`;
}
