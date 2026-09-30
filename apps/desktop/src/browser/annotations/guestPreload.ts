import { ipcRenderer } from "electron";
import type {
  BrowserAnnotation,
  BrowserAnnotationMarker,
  BrowserAnnotationSource,
  BrowserAnnotationTheme,
} from "@glade/contracts/browser/browserAnnotations";
import {
  browserAnnotationDocumentIdentityUrl,
  sanitizeBrowserAnnotationUrl,
} from "@glade/shared/browser/browserAnnotations";

import {
  BROWSER_ANNOTATION_GUEST_COMMAND_CHANNEL,
  BROWSER_IPC_CHANNELS,
} from "../../main/ipc/ipcChannels";
import {
  formatCssBorderRadius,
  formatElementSize,
  inspectorCardFor,
  type ElementStyleSnapshot,
  type InspectorCard,
} from "./elementInspection";
import { createGuestIdentifier } from "./guestIdentity";
import {
  GUEST_ANNOTATION_MAX_COMMENT_LENGTH,
  GUEST_ANNOTATION_MAX_NAME_LENGTH,
  GUEST_ANNOTATION_MAX_PAGE_TITLE_LENGTH,
  GUEST_ANNOTATION_MAX_ROLE_LENGTH,
  GUEST_ANNOTATION_MAX_SELECTOR_LENGTH,
  GUEST_ANNOTATION_MAX_TAG_NAME_LENGTH,
  GUEST_ANNOTATION_MAX_TEXT_LENGTH,
  GUEST_ANNOTATION_MAX_URL_LENGTH,
  GUEST_ANNOTATION_PROTOCOL_VERSION,
  isGuestAnnotationCommand,
} from "./guestProtocol";
import "../webMcp/guestBridge";

const HOST_ATTRIBUTE = "data-glade-browser-annotations";

const MARKER_REVALIDATE_DELAY_MS = 400;
const VIEWPORT_GAP = 12;
const ANCHOR_GAP = 18;
const INSPECTOR_GAP = 8;
const NOTICE_GAP = 8;
const COMMENT_MIN_HEIGHT = 22;
const COMMENT_MAX_HEIGHT = 112;

const INSPECTION_REFRESH_INTERVAL_MS = 100;

const NOTICE_DURATION_MS = 4_000;
const UNANCHORABLE_NOTICE = "This element can't be pinned. Try one next to it.";
const INVISIBLE_TARGET_NOTICE = "This element has no visible box. Try one next to it.";
const STALE_TARGET_NOTICE = "This element changed. Pick it again — your comment is kept.";

const FINGERPRINT_SEPARATOR = String.fromCharCode(31);
const documentToken = createGuestIdentifier(globalThis.crypto);

let lastDocumentHref = globalThis.location.href;

let lastDocumentIdentityUrl = browserAnnotationDocumentIdentityUrl(globalThis.location.href);

interface ResolvedMarker {
  readonly id: string;
  readonly element: Element;
  readonly badge: HTMLElement;
}

let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let outline: HTMLElement | null = null;
let inspector: HTMLElement | null = null;
let inspectorTag: HTMLElement | null = null;
let inspectorSize: HTMLElement | null = null;
let inspectorRows: HTMLElement | null = null;
let popover: HTMLElement | null = null;
let popoverTag: HTMLElement | null = null;
let textarea: HTMLTextAreaElement | null = null;
let badgeLayer: HTMLElement | null = null;
let submitButton: HTMLButtonElement | null = null;
let cursorBubble: HTMLElement | null = null;
let notice: HTMLElement | null = null;

let activeSession: { sessionId: string } | null = null;
let hoveredElement: Element | null = null;
let selectedElement: Element | null = null;

let selectionAnchor: { x: number; y: number } | null = null;
let inspectedElement: Element | null = null;
let inspectedCard: InspectorCard | null = null;
let lastInspectionRefreshAt = Number.NEGATIVE_INFINITY;

const pointer = { x: 0, y: 0, inside: false, overOverlay: false };
let pointerNeedsHitTest = false;

let noticeText: string | null = null;
let noticeAnchor: { x: number; y: number } | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

let projectedMarkers: readonly BrowserAnnotationMarker[] = [];
let projectionVersion = 0;
let projectionAckPending = false;
let resolvedMarkers: readonly ResolvedMarker[] = [];
const badgePool: HTMLElement[] = [];
let markersNeedResolve = false;
let markerRevalidateTimer: ReturnType<typeof setTimeout> | null = null;
let markerResizeObserver: ResizeObserver | null = null;
let observedMarkerTargets = new Set<Element>();

let frameHandle: number | null = null;
let interactionListenersInstalled = false;
let pageCursorSheet: CSSStyleSheet | null = null;
const suppressedKeyups = new Set<string>();

function normalizedText(value: string, maximumLength: number): string {
  return value
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

function currentSource(): BrowserAnnotationSource {
  return {
    url: sanitizeBrowserAnnotationUrl(new URL(globalThis.location.href).href),
    pageTitle: normalizedText(document.title, GUEST_ANNOTATION_MAX_PAGE_TITLE_LENGTH),
  };
}

function sendReady(source = currentSource()): void {
  ipcRenderer.send(BROWSER_IPC_CHANNELS.annotations.guestMessage, {
    version: GUEST_ANNOTATION_PROTOCOL_VERSION,
    kind: "ready",
    documentToken,
    source,
  });
}

// Drop a stale projection immediately when the sanitized source URL changes, but keep it across
// fragment-only navigation because fragments are not part of annotation identity and the same
// markers remain valid.
function handleDocumentIdentityChange(): void {
  const source = currentSource();
  const documentIdentityUrl = browserAnnotationDocumentIdentityUrl(globalThis.location.href);
  const identityChanged = documentIdentityUrl !== lastDocumentIdentityUrl;
  lastDocumentHref = globalThis.location.href;
  lastDocumentIdentityUrl = documentIdentityUrl;
  if (identityChanged) {
    projectedMarkers = [];
    projectionAckPending = false;
    markersNeedResolve = true;
    scheduleFrame();
  }
  sendReady(source);
}

function handleHistoryNavigation(): void {
  if (globalThis.location.href === lastDocumentHref) return;
  if (activeSession) endInteractiveSession(false);
  handleDocumentIdentityChange();
}

function cssEscape(value: string): string {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
  return value.replace(/(^-?\d)|[^a-zA-Z0-9_-]/g, (character, leadingDigit) =>
    leadingDigit ? `\\3${character} ` : `\\${character}`,
  );
}

function looksSensitiveLocator(value: string): boolean {
  return (
    /\b(?:authorization|password|passwd|secret|api[-_]?key|auth|session|token|credential)\b/i.test(
      value,
    ) ||
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.test(value) ||
    /(?:^|[-_:])[A-Za-z0-9_-]{24,}(?:$|[-_:])/.test(value)
  );
}

function uniqueIdSelector(element: Element): string | null {
  if (!element.id || looksSensitiveLocator(element.id)) return null;
  const byId = `#${cssEscape(element.id)}`;
  if (byId.length > GUEST_ANNOTATION_MAX_SELECTOR_LENGTH) return null;
  try {
    return document.querySelectorAll(byId).length === 1 ? byId : null;
  } catch {
    return null;
  }
}

function uniqueSelector(element: Element): string | null {
  const byId = uniqueIdSelector(element);
  if (byId) return byId;
  const segments: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.documentElement) {
    const parent: Element | null = current.parentElement;
    const tag = current.tagName.toLowerCase();
    if (!parent) {
      segments.unshift(tag);
      break;
    }
    const siblings = Array.from(parent.children).filter(
      (candidate) => candidate.tagName === current?.tagName,
    );
    const index = siblings.indexOf(current) + 1;
    segments.unshift(`${tag}:nth-of-type(${Math.max(1, index)})`);

    const anchor = uniqueIdSelector(parent);
    if (anchor) {
      const anchored = [anchor, ...segments].join(" > ");
      if (anchored.length <= GUEST_ANNOTATION_MAX_SELECTOR_LENGTH) return anchored;
    }
    current = parent;
  }
  segments.unshift("html");
  const selector = segments.join(" > ");
  return selector.length <= GUEST_ANNOTATION_MAX_SELECTOR_LENGTH ? selector : null;
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

function implicitRole(element: Element): string {
  const tagName = element.tagName;
  if (tagName === "BUTTON") return "button";
  if (tagName === "A" && element.hasAttribute("href")) return "link";
  if (tagName === "TEXTAREA") return "textbox";
  if (tagName === "SELECT") {
    return element instanceof HTMLSelectElement && (element.multiple || element.size > 1)
      ? "listbox"
      : "combobox";
  }
  if (tagName === "INPUT" && element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase();
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (["button", "submit", "reset", "image"].includes(type)) return "button";
    if (type === "range") return "slider";
    if (type === "number") return "spinbutton";
    if (type === "search") return "searchbox";
    if (type !== "hidden") return "textbox";
  }
  if (tagName === "IMG") return "img";
  if (tagName === "MAIN") return "main";
  if (tagName === "NAV") return "navigation";
  if (tagName === "FORM") return "form";
  if (tagName === "TABLE") return "table";
  if (tagName === "LI") return "listitem";
  if (tagName === "UL" || tagName === "OL") return "list";
  return "";
}

function labelledByText(element: Element): string {
  const ids = element.getAttribute("aria-labelledby")?.split(/\s+/).filter(Boolean);
  if (!ids || ids.length === 0) return "";
  return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
}

function associatedLabelText(element: Element): string {
  if (
    !(
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLButtonElement
    )
  ) {
    return "";
  }
  return Array.from(element.labels ?? [])
    .map((label) => label.innerText)
    .join(" ");
}

function elementAccessibleName(element: Element): string {
  const directName =
    element.getAttribute("aria-label") ||
    labelledByText(element) ||
    associatedLabelText(element) ||
    element.getAttribute("alt") ||
    element.getAttribute("title") ||
    "";
  if (directName) return normalizedText(directName, GUEST_ANNOTATION_MAX_NAME_LENGTH);
  if (
    element instanceof HTMLInputElement &&
    ["button", "submit", "reset"].includes(element.type.toLowerCase())
  ) {
    return normalizedText(element.value, GUEST_ANNOTATION_MAX_NAME_LENGTH);
  }
  if (
    element instanceof HTMLElement &&
    ["BUTTON", "A", "SUMMARY", "OPTION"].includes(element.tagName)
  ) {
    return normalizedText(element.innerText, GUEST_ANNOTATION_MAX_NAME_LENGTH);
  }
  return "";
}

function elementFingerprint(element: Element): string {
  const structuralParts: string[] = [];
  let current: Element | null = element;
  let depth = 0;
  while (current && depth < 16) {
    const parent: Element | null = current.parentElement;
    const sameTagIndex = parent
      ? Array.from(parent.children)
          .filter((candidate) => candidate.tagName === current?.tagName)
          .indexOf(current)
      : 0;
    structuralParts.unshift(`${current.tagName.toLowerCase()}:${Math.max(0, sameTagIndex)}`);
    current = parent;
    depth += 1;
  }
  structuralParts.push(
    `role:${normalizedText(element.getAttribute("role") ?? implicitRole(element), 64)}`,
  );
  return fnv1a64(structuralParts.join(FINGERPRINT_SEPARATOR));
}

function isSensitiveElement(element: Element): boolean {
  const tag = element.tagName;
  return (
    (element instanceof HTMLInputElement &&
      !["button", "submit", "reset", "image"].includes(element.type.toLowerCase())) ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    tag === "OPTION" ||
    (element instanceof HTMLElement && element.isContentEditable) ||
    element.matches("[autocomplete*='password' i], [autocomplete*='cc-' i]") ||
    element.querySelector("input[type='password'], [autocomplete*='cc-' i], [contenteditable]") !==
      null
  );
}

function annotationSelectorFor(element: Element): string | null {
  if (currentSource().url.length > GUEST_ANNOTATION_MAX_URL_LENGTH) return null;
  return uniqueSelector(element);
}

function describeElement(element: Element, comment: string): BrowserAnnotation | null {
  const sensitive = isSensitiveElement(element);
  const role =
    normalizedText(
      element.getAttribute("role") ?? implicitRole(element),
      GUEST_ANNOTATION_MAX_ROLE_LENGTH,
    ) || null;
  const name = sensitive ? null : elementAccessibleName(element) || null;
  const rawText = element instanceof HTMLElement ? element.innerText : element.textContent;
  const text = sensitive
    ? null
    : normalizedText(rawText ?? "", GUEST_ANNOTATION_MAX_TEXT_LENGTH) || null;
  const selector = annotationSelectorFor(element);
  if (!selector) return null;
  return {
    id: createGuestIdentifier(globalThis.crypto),
    source: currentSource(),
    selector,

    tagName: element.tagName.slice(0, GUEST_ANNOTATION_MAX_TAG_NAME_LENGTH),
    role,
    name,
    text,
    fingerprint: elementFingerprint(element),
    comment:
      normalizedText(comment, GUEST_ANNOTATION_MAX_COMMENT_LENGTH).trim().length > 0
        ? normalizedText(comment, GUEST_ANNOTATION_MAX_COMMENT_LENGTH)
        : null,
    capturedAt: new Date().toISOString(),
  };
}

function isOverlayTarget(target: EventTarget | null): boolean {
  return target instanceof Node && host?.contains(target) === true;
}

function isolateInteractionEvent(event: Event, preventPageDefault = true): boolean {
  const overlayTarget = isOverlayTarget(event.target);
  if (!overlayTarget && preventPageDefault && event.cancelable) {
    event.preventDefault();
  }
  event.stopImmediatePropagation();
  event.stopPropagation();
  return overlayTarget;
}

function keyboardEventIdentity(event: KeyboardEvent): string {
  return event.code || event.key;
}

function targetAtPoint(x: number, y: number): Element | null {
  const candidate = document.elementFromPoint(x, y);
  if (!candidate || candidate === host || candidate.closest(`[${HOST_ATTRIBUTE}]`)) return null;
  return candidate;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function scheduleFrame(): void {
  if (frameHandle !== null) return;
  if (!activeSession && !markersNeedResolve && resolvedMarkers.length === 0) return;
  frameHandle = globalThis.requestAnimationFrame(runFrame);
}

function runFrame(): void {
  frameHandle = null;
  renderOverlay();

  if (activeSession && !document.hidden) scheduleFrame();
}

function invalidateMarkersSoon(): void {
  if (markerRevalidateTimer !== null || projectedMarkers.length === 0) return;
  markerRevalidateTimer = setTimeout(() => {
    markerRevalidateTimer = null;
    markersNeedResolve = true;
    scheduleFrame();
  }, MARKER_REVALIDATE_DELAY_MS);
}

function styleSnapshot(style: CSSStyleDeclaration): ElementStyleSnapshot {
  return {
    color: style.color,
    backgroundColor: style.backgroundColor,
    fontWeight: style.fontWeight,
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    fontFamily: style.fontFamily,
    padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
    margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft],
    radius: [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomRightRadius,
      style.borderBottomLeftRadius,
    ],
  };
}

function paintInspectorRows(card: InspectorCard): void {
  if (!inspectorRows || !inspectorTag || !popoverTag) return;
  inspectorTag.textContent = card.tag;
  popoverTag.textContent = card.tag;
  const rows = document.createDocumentFragment();
  for (const row of card.rows) {
    const line = document.createElement("div");
    line.className = "row";
    const key = document.createElement("span");
    key.className = "key";
    key.textContent = row.label;
    const value = document.createElement("span");
    value.className = "value";

    value.textContent = row.value;
    line.append(key, value);
    rows.append(line);
  }
  inspectorRows.replaceChildren(rows);
}

function inspectorCardsMatch(left: InspectorCard | null, right: InspectorCard): boolean {
  return (
    left?.tag === right.tag &&
    left.rows.length === right.rows.length &&
    left.rows.every(
      (row, index) =>
        row.label === right.rows[index]?.label && row.value === right.rows[index]?.value,
    )
  );
}

function refreshInspection(element: Element | null, rect: DOMRect | null): void {
  if (!element || !rect || !outline) {
    inspectedElement = element;
    inspectedCard = null;
    return;
  }
  const now = globalThis.performance.now();
  if (
    element === inspectedElement &&
    now - lastInspectionRefreshAt < INSPECTION_REFRESH_INTERVAL_MS
  ) {
    return;
  }
  inspectedElement = element;
  lastInspectionRefreshAt = now;
  const style = globalThis.getComputedStyle(element);
  const nextCard = inspectorCardFor({
    tagName: element.tagName,
    width: rect.width,
    height: rect.height,
    style: styleSnapshot(style),
  });
  if (!inspectorCardsMatch(inspectedCard, nextCard)) paintInspectorRows(nextCard);
  inspectedCard = nextCard;

  const borderRadius = formatCssBorderRadius([
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ]);
  if (outline.style.borderRadius !== borderRadius) outline.style.borderRadius = borderRadius;
}

function boundsOf(element: Element | null): DOMRect | null {
  if (!element?.isConnected) return null;
  const bounds = element.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0 ? bounds : null;
}

function placeCard(card: HTMLElement, size: DOMRect, left: number, top: number): void {
  card.style.transform = `translate3d(${Math.round(
    clamp(left, VIEWPORT_GAP, globalThis.innerWidth - size.width - VIEWPORT_GAP),
  )}px,${Math.round(
    clamp(top, VIEWPORT_GAP, globalThis.innerHeight - size.height - VIEWPORT_GAP),
  )}px,0)`;
}

function besideAnchor(anchorX: number, width: number): number {
  const maxLeft = globalThis.innerWidth - width - VIEWPORT_GAP;
  return anchorX + ANCHOR_GAP <= maxLeft ? anchorX + ANCHOR_GAP : anchorX - width - ANCHOR_GAP;
}

function positionOutline(bounds: DOMRect): void {
  if (!outline) return;
  outline.style.width = `${bounds.width}px`;
  outline.style.height = `${bounds.height}px`;
  outline.style.transform = `translate3d(${bounds.left}px,${bounds.top}px,0)`;
}

function positionInspector(bounds: DOMRect, size: DOMRect): void {
  if (!inspector) return;
  const above = bounds.top - size.height - INSPECTOR_GAP;
  placeCard(
    inspector,
    size,
    bounds.left,
    above >= VIEWPORT_GAP ? above : bounds.bottom + INSPECTOR_GAP,
  );
}

function positionPopover(bounds: DOMRect, size: DOMRect): void {
  if (!popover) return;
  const anchorX = bounds.left + (selectionAnchor?.x ?? bounds.width / 2);
  const anchorY = bounds.top + (selectionAnchor?.y ?? bounds.height / 2);
  placeCard(popover, size, besideAnchor(anchorX, size.width), anchorY - size.height / 2);
}

function positionNotice(size: DOMRect, composer: DOMRect | null): void {
  if (!notice) return;
  // With the composer open the notice belongs under it; otherwise it sits beside the pointer exactly
  // like the composer would.
  if (composer) {
    placeCard(notice, size, composer.left, composer.bottom + NOTICE_GAP);
    return;
  }
  const anchorX = noticeAnchor?.x ?? 0;
  const anchorY = noticeAnchor?.y ?? 0;
  placeCard(notice, size, besideAnchor(anchorX, size.width), anchorY - size.height / 2);
}

function hideNotice(): void {
  noticeText = null;
  noticeAnchor = null;
  if (noticeTimer !== null) {
    clearTimeout(noticeTimer);
    noticeTimer = null;
  }
}

function showNotice(message: string): void {
  noticeText = message;
  noticeAnchor = { x: pointer.x, y: pointer.y };
  if (notice) notice.textContent = message;
  if (noticeTimer !== null) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    noticeTimer = null;
    hideNotice();
    scheduleFrame();
  }, NOTICE_DURATION_MS);
  scheduleFrame();
}

function badgeAt(index: number): HTMLElement {
  const existing = badgePool[index];
  if (existing) return existing;
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.hidden = true;
  badgeLayer?.append(badge);
  badgePool.push(badge);
  return badge;
}

function resolveMarkers(): void {
  markersNeedResolve = false;
  const source = currentSource();
  const next: ResolvedMarker[] = [];
  for (const marker of projectedMarkers) {
    if (marker.source.url !== source.url) continue;
    let matches: NodeListOf<Element>;
    try {
      matches = document.querySelectorAll(marker.selector);
    } catch {
      continue;
    }
    if (matches.length !== 1) continue;
    const target = matches[0];
    if (!target || elementFingerprint(target) !== marker.fingerprint) continue;
    const badge = badgeAt(next.length);
    badge.textContent = String(marker.ordinal);
    next.push({ id: marker.id, element: target, badge });
  }
  for (let index = next.length; index < badgePool.length; index += 1) {
    const badge = badgePool[index];
    if (badge) badge.hidden = true;
  }
  resolvedMarkers = next;

  const nextObservedTargets = new Set(next.map((marker) => marker.element));
  if (
    markerResizeObserver &&
    (nextObservedTargets.size !== observedMarkerTargets.size ||
      [...nextObservedTargets].some((target) => !observedMarkerTargets.has(target)))
  ) {
    markerResizeObserver.disconnect();
    markerResizeObserver.observe(document.documentElement);
    for (const target of nextObservedTargets) markerResizeObserver.observe(target);
    observedMarkerTargets = nextObservedTargets;
  }

  if (projectionAckPending) {
    projectionAckPending = false;
    ipcRenderer.send(BROWSER_IPC_CHANNELS.annotations.guestMessage, {
      version: GUEST_ANNOTATION_PROTOCOL_VERSION,
      kind: "markers-projected",
      documentToken,
      projectionVersion,
      projectedMarkerIds: next.map((marker) => marker.id),
    });
  }
}

function measureMarkers(): readonly (DOMRect | null)[] {
  return resolvedMarkers.map((marker) => {
    if (!marker.element.isConnected) {
      invalidateMarkersSoon();
      return null;
    }
    return marker.element.getBoundingClientRect();
  });
}

function paintMarkers(measured: readonly (DOMRect | null)[]): void {
  for (const [index, marker] of resolvedMarkers.entries()) {
    const bounds = measured[index] ?? null;
    const offscreen =
      bounds === null ||
      bounds.width <= 0 ||
      bounds.height <= 0 ||
      bounds.right <= 0 ||
      bounds.bottom <= 0 ||
      bounds.left >= globalThis.innerWidth ||
      bounds.top >= globalThis.innerHeight;
    marker.badge.hidden = offscreen;
    if (offscreen || !bounds) continue;
    marker.badge.style.transform = `translate3d(${Math.round(bounds.right)}px,${Math.round(bounds.top)}px,0) translate(-50%,-50%)`;
  }
}

function renderOverlay(): void {
  if (!outline || !popover || !badgeLayer || !inspector || !cursorBubble) return;
  if (host && !host.isConnected && document.documentElement) {
    document.documentElement.append(host);
  }
  if (selectedElement && !selectedElement.isConnected) {
    releaseSelectionWithNotice(STALE_TARGET_NOTICE);
  }
  if (hoveredElement && !hoveredElement.isConnected) hoveredElement = null;

  if (activeSession && pointerNeedsHitTest && !selectedElement) {
    pointerNeedsHitTest = false;
    hoveredElement = pointer.inside ? targetAtPoint(pointer.x, pointer.y) : null;
  }
  if (markersNeedResolve) resolveMarkers();

  const focus = activeSession ? (selectedElement ?? hoveredElement) : null;
  const bounds = boundsOf(focus);
  if (selectedElement && !bounds) {
    releaseSelectionWithNotice(INVISIBLE_TARGET_NOTICE);
  }
  const measuredMarkers = measureMarkers();

  // Then the content and visibility of every card, because a hidden card measures as a zero box and a
  // late text change would invalidate a measurement already taken.
  refreshInspection(bounds ? focus : null, bounds);
  const showsComposer = bounds !== null && selectedElement !== null;
  const showsInspector = bounds !== null && !showsComposer && inspectedCard !== null;
  const showsCursor = activeSession !== null && pointer.inside && !pointer.overOverlay;
  outline.hidden = bounds === null;
  popover.hidden = !showsComposer;
  inspector.hidden = !showsInspector;
  cursorBubble.hidden = !showsCursor;
  if (notice) notice.hidden = noticeText === null;
  if (bounds && showsInspector && inspectorSize) {
    const size = formatElementSize(bounds.width, bounds.height);
    if (inspectorSize.textContent !== size) inspectorSize.textContent = size;
  }

  const composerCard = showsComposer ? popover.getBoundingClientRect() : null;
  const inspectorCard = showsInspector ? inspector.getBoundingClientRect() : null;
  const noticeCard = notice && noticeText !== null ? notice.getBoundingClientRect() : null;

  if (bounds) positionOutline(bounds);
  if (bounds && composerCard) positionPopover(bounds, composerCard);
  if (bounds && inspectorCard) positionInspector(bounds, inspectorCard);
  if (showsCursor) {
    cursorBubble.style.transform = `translate3d(${Math.round(pointer.x)}px,${Math.round(pointer.y)}px,0) translate(0,-100%)`;
  }
  if (noticeCard) positionNotice(noticeCard, composerCard);
  paintMarkers(measuredMarkers);
}

function setPageCursorHidden(hidden: boolean): void {
  try {
    if (hidden) {
      if (!pageCursorSheet) {
        pageCursorSheet = new CSSStyleSheet();

        pageCursorSheet.replaceSync("*,*::before,*::after{cursor:none!important}");
      }
      if (!document.adoptedStyleSheets.includes(pageCursorSheet)) {
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, pageCursorSheet];
      }
      return;
    }
    if (pageCursorSheet) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        (sheet) => sheet !== pageCursorSheet,
      );
    }
  } catch {}
}

function autoSizeComment(): void {
  if (!textarea || !popover) return;
  textarea.style.height = "0px";
  const height = Math.max(COMMENT_MIN_HEIGHT, Math.min(textarea.scrollHeight, COMMENT_MAX_HEIGHT));
  textarea.style.height = `${height}px`;
  popover.toggleAttribute("data-multiline", height > 24);
}

function clearSelection(options: { readonly keepComment?: boolean } = {}): void {
  selectedElement = null;
  selectionAnchor = null;
  hoveredElement = null;

  pointerNeedsHitTest = true;
  if (textarea && options.keepComment !== true) {
    textarea.value = "";
    autoSizeComment();
  }
}

function releaseSelectionWithNotice(message: string): void {
  clearSelection({ keepComment: true });
  showNotice(message);
}

function selectTarget(target: Element, point: { x: number; y: number } | null): void {
  const bounds = boundsOf(target);
  if (!bounds) {
    showNotice(INVISIBLE_TARGET_NOTICE);
    return;
  }

  if (!annotationSelectorFor(target)) {
    showNotice(UNANCHORABLE_NOTICE);
    return;
  }
  hideNotice();
  selectedElement = target;
  hoveredElement = target;
  selectionAnchor = {
    x: point ? clamp(point.x - bounds.left, 0, bounds.width) : bounds.width / 2,
    y: point ? clamp(point.y - bounds.top, 0, bounds.height) : bounds.height / 2,
  };

  renderOverlay();

  autoSizeComment();
  renderOverlay();
  textarea?.focus({ preventScroll: true });
}

function endInteractiveSession(notifyHost: boolean): void {
  const session = activeSession;
  activeSession = null;
  clearSelection();
  hideNotice();
  inspectedElement = null;
  inspectedCard = null;
  pointer.inside = false;
  pointer.overOverlay = false;
  setPageCursorHidden(false);
  host?.removeAttribute("data-interactive");
  renderOverlay();
  if (notifyHost && session) {
    ipcRenderer.send(BROWSER_IPC_CHANNELS.annotations.guestMessage, {
      version: GUEST_ANNOTATION_PROTOCOL_VERSION,
      kind: "cancelled",
      documentToken,
      sessionId: session.sessionId,
    });
  }
}

function submitAnnotation(): void {
  const session = activeSession;
  const target = selectedElement;
  if (!session || !target) return;
  if (!target.isConnected) {
    releaseSelectionWithNotice(STALE_TARGET_NOTICE);
    renderOverlay();
    return;
  }
  if (!boundsOf(target)) {
    releaseSelectionWithNotice(INVISIBLE_TARGET_NOTICE);
    renderOverlay();
    return;
  }
  const annotation = describeElement(target, textarea?.value ?? "");
  if (!annotation) {
    releaseSelectionWithNotice(STALE_TARGET_NOTICE);
    renderOverlay();
    return;
  }
  clearSelection();
  hideNotice();
  inspectedElement = null;
  renderOverlay();
  ipcRenderer.send(BROWSER_IPC_CHANNELS.annotations.guestMessage, {
    version: GUEST_ANNOTATION_PROTOCOL_VERSION,
    kind: "committed",
    documentToken,
    sessionId: session.sessionId,
    annotation,
  });
}

function applyVisualTheme(theme: BrowserAnnotationTheme): void {
  if (!host) return;
  host.setAttribute("data-theme", theme.mode);
  host.style.setProperty("--annotation-accent", theme.accent);
  host.style.setProperty("--annotation-surface", theme.surface);
  host.style.setProperty("--annotation-text", theme.text);
  host.style.setProperty("--annotation-muted-text", theme.mutedText);
  host.style.setProperty("--annotation-border", theme.border);
  host.style.setProperty("--annotation-focus-border", theme.focusBorder);
  host.style.setProperty("--annotation-primary", theme.primary);
  host.style.setProperty("--annotation-primary-text", theme.primaryText);
}

function installInteractionListeners(): void {
  if (interactionListenersInstalled) return;
  interactionListenersInstalled = true;

  globalThis.addEventListener(
    "pointermove",
    (event) => {
      if (!activeSession) return;
      const overlayTarget = isOverlayTarget(event.target);
      isolateInteractionEvent(event);
      // The session hides the native cursor, so the bubble is the only cursor the user can see. Synthetic
      // moves must never steer it: a page that could would show the outline and inspector on one element
      // while the real pointer — and therefore the click — sat on another.
      if (!event.isTrusted) return;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.inside = true;
      pointer.overOverlay = overlayTarget;

      if (!overlayTarget && !selectedElement) pointerNeedsHitTest = true;
      scheduleFrame();
    },
    true,
  );
  globalThis.addEventListener(
    "pointerdown",
    (event) => {
      if (!activeSession) return;
      if (isolateInteractionEvent(event)) return;
      if (!event.isTrusted) return;
      const target = targetAtPoint(event.clientX, event.clientY);
      if (!target) return;
      selectTarget(target, { x: event.clientX, y: event.clientY });
    },
    true,
  );
  globalThis.addEventListener(
    "click",
    (event) => {
      if (!activeSession) return;
      if (isolateInteractionEvent(event)) {
        if (
          event.isTrusted &&
          submitButton !== null &&
          (eventHitsElement(event, submitButton) || shadow?.activeElement === submitButton)
        ) {
          submitAnnotation();
        }
        return;
      }

      if (!selectedElement && event.isTrusted && event.target instanceof Element) {
        selectTarget(event.target, null);
      }
    },
    true,
  );
  globalThis.addEventListener(
    "keydown",
    (event) => {
      if (!activeSession) return;
      const overlayTarget = isOverlayTarget(event.target);
      isolateInteractionEvent(event, !overlayTarget);
      // The host element is discoverable in the page's DOM, so a page script can aim synthetic key events
      // at it. Isolate those like any other event, but never let them cancel the session or publish the
      // user's comment.
      if (!event.isTrusted) return;
      suppressedKeyups.add(keyboardEventIdentity(event));

      if (event.isComposing) return;
      if (event.key === "Escape") {
        if (overlayTarget) event.preventDefault();
        endInteractiveSession(true);
        return;
      }
      if (!overlayTarget) return;
      const submitsFromComment =
        shadow?.activeElement === textarea && event.key === "Enter" && !event.shiftKey;
      const submitsFromButton =
        submitButton !== null &&
        shadow?.activeElement === submitButton &&
        (event.key === "Enter" || event.key === " ");
      if (submitsFromComment || submitsFromButton) {
        event.preventDefault();
        submitAnnotation();
      }
    },
    true,
  );

  globalThis.addEventListener(
    "keyup",
    (event) => {
      const identity = keyboardEventIdentity(event);
      const startedInsidePicker = suppressedKeyups.delete(identity);
      if (!activeSession && !startedInsidePicker) return;
      isolateInteractionEvent(event, !isOverlayTarget(event.target));
    },
    true,
  );

  for (const eventType of [
    "pointerup",
    "pointercancel",
    "pointerrawupdate",
    "pointerover",
    "pointerout",
    "pointerenter",
    "pointerleave",
    "mousedown",
    "mousemove",
    "mouseup",
    "mouseover",
    "mouseout",
    "mouseenter",
    "mouseleave",
    "auxclick",
    "dblclick",
    "contextmenu",
    "touchstart",
    "touchmove",
    "touchend",
    "touchcancel",
    "dragstart",
    "drag",
    "dragend",
    "dragenter",
    "dragleave",
    "dragover",
    "drop",
  ]) {
    globalThis.addEventListener(
      eventType,
      (event) => {
        if (!activeSession) return;
        if (
          eventType === "pointerout" &&
          event.isTrusted &&
          event instanceof PointerEvent &&
          event.relatedTarget === null
        ) {
          pointer.inside = false;
          pointerNeedsHitTest = true;
          scheduleFrame();
        }
        isolateInteractionEvent(event);
      },
      true,
    );
  }

  for (const eventType of [
    "keypress",
    "beforeinput",
    "input",
    "textInput",
    "paste",
    "copy",
    "cut",
    "compositionstart",
    "compositionupdate",
    "compositionend",
    "focusin",
    "focusout",
    "wheel",
  ]) {
    globalThis.addEventListener(
      eventType,
      (event) => {
        if (!activeSession) return;
        const overlayTarget = isolateInteractionEvent(
          event,
          eventType !== "wheel" && !isOverlayTarget(event.target),
        );

        if (overlayTarget && eventType === "input" && shadow?.activeElement === textarea) {
          autoSizeComment();
          scheduleFrame();
        }
      },
      true,
    );
  }
  // A key held while the window loses focus never delivers its keyup here, so the pending identity
  // would otherwise swallow the page's own keyup for that key long after the session ended.
  globalThis.addEventListener("blur", () => suppressedKeyups.clear());
  document.addEventListener("scroll", scheduleFrame, true);
  globalThis.addEventListener("resize", scheduleFrame);
  document.addEventListener("visibilitychange", scheduleFrame);
}

function eventHitsElement(event: MouseEvent, element: Element | null): boolean {
  if (!element?.isConnected) return false;
  const bounds = element.getBoundingClientRect();
  return (
    event.clientX >= bounds.left &&
    event.clientX <= bounds.right &&
    event.clientY >= bounds.top &&
    event.clientY <= bounds.bottom
  );
}

const OVERLAY_STYLE = `
  :host {
    --annotation-accent:rgb(82,111,255);
    --annotation-surface:rgb(255,255,255);
    --annotation-text:rgb(23,23,23);
    --annotation-muted-text:rgb(115,115,115);
    --annotation-border:rgb(212,212,212);
    --annotation-focus-border:rgb(82,111,255);
    --annotation-primary:rgb(23,23,23);
    --annotation-primary-text:rgb(255,255,255);
    --annotation-mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
    --annotation-sans:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    --annotation-card-shadow:0 12px 32px -14px rgb(0 0 0 / .38),0 1px 2px rgb(0 0 0 / .10);
  }
  * { box-sizing:border-box; }
  .layer { position:fixed; left:0; top:0; width:0; height:0; }
  .outline {
    position:fixed;
    left:0;
    top:0;
    border:2px solid var(--annotation-accent);
    background:color-mix(in srgb,var(--annotation-accent) 8%,transparent);
    box-shadow:0 0 0 1px rgb(255 255 255 / .45);
    pointer-events:none;
    will-change:transform,width,height;
  }
  .inspector {
    position:fixed;
    left:0;
    top:0;
    display:grid;
    gap:2px;
    min-width:170px;
    max-width:min(340px,calc(100vw - 24px));
    padding:8px 11px 9px;
    border:1px solid color-mix(in srgb,var(--annotation-border) 55%,transparent);
    border-radius:12px;
    background:var(--annotation-surface);
    color:var(--annotation-text);
    box-shadow:var(--annotation-card-shadow);
    font:400 11px/1.5 var(--annotation-mono);
    pointer-events:none;
    will-change:transform;
  }
  .row { display:grid; grid-template-columns:auto minmax(0,1fr); align-items:baseline; gap:16px; }
  .key { color:var(--annotation-muted-text); }
  .value { overflow:hidden; text-align:right; text-overflow:ellipsis; white-space:nowrap; }
  .row.head .key { color:var(--annotation-text); font-weight:600; }
  .popover {
    position:fixed;
    left:0;
    top:0;
    display:flex;
    align-items:center;
    gap:9px;
    width:min(360px,calc(100vw - 24px));
    padding:7px 7px 7px 12px;
    border:1px solid color-mix(in srgb,var(--annotation-border) 55%,transparent);
    border-radius:24px;
    background:var(--annotation-surface);
    color:var(--annotation-text);
    box-shadow:var(--annotation-card-shadow);
    font:400 14px/1.45 var(--annotation-sans);
    cursor:default;
    pointer-events:auto;
    will-change:transform;
  }
  .popover[data-multiline] { align-items:flex-end; border-radius:18px; }
  .popover:focus-within { border-color:color-mix(in srgb,var(--annotation-focus-border) 60%,transparent); }
  .chip {
    flex:none;
    padding:2px 7px;
    border-radius:999px;
    background:color-mix(in srgb,var(--annotation-accent) 14%,transparent);
    color:var(--annotation-accent);
    font:600 10px/1.6 var(--annotation-mono);
    letter-spacing:.02em;
  }
  textarea {
    flex:1 1 auto;
    min-width:0;
    height:22px;
    max-height:${COMMENT_MAX_HEIGHT}px;
    padding:0;
    border:0;
    background:transparent;
    color:var(--annotation-text);
    font:inherit;
    resize:none;
    overflow:auto;
    outline:none;
    cursor:text;
  }
  textarea::placeholder { color:color-mix(in srgb,var(--annotation-muted-text) 72%,transparent); opacity:1; }
  button {
    flex:none;
    display:grid;
    place-items:center;
    width:30px;
    height:30px;
    border:0;
    border-radius:999px;
    padding:0;
    background:var(--annotation-primary);
    color:var(--annotation-primary-text);
    cursor:pointer;
    transition:opacity 120ms ease-out,transform 100ms ease-out;
  }
  button:hover { opacity:.88; }
  button:active { transform:scale(.94); }
  button:focus-visible { outline:2px solid var(--annotation-focus-border); outline-offset:2px; }
  button svg { width:15px; height:15px; }
  .notice {
    position:fixed;
    left:0;
    top:0;
    max-width:min(320px,calc(100vw - 24px));
    padding:6px 11px 7px;
    border:1px solid color-mix(in srgb,var(--annotation-border) 55%,transparent);
    border-radius:12px;
    background:var(--annotation-surface);
    color:var(--annotation-text);
    box-shadow:var(--annotation-card-shadow);
    font:500 12px/1.45 var(--annotation-sans);
    pointer-events:none;
    will-change:transform;
  }
  .cursor {
    position:fixed;
    left:0;
    top:0;
    width:20px;
    height:20px;
    border-radius:50% 50% 50% 3px;
    background:var(--annotation-accent);
    box-shadow:0 0 0 2px color-mix(in srgb,var(--annotation-surface) 75%,transparent),0 3px 10px rgb(0 0 0 / .3);
    pointer-events:none;
    will-change:transform;
  }
  .badge {
    position:fixed;
    left:0;
    top:0;
    display:grid;
    place-items:center;
    min-width:22px;
    height:22px;
    padding:0 6px;
    border:2px solid var(--annotation-surface);
    border-radius:999px;
    background:var(--annotation-accent);
    color:rgb(255 255 255);
    box-shadow:0 2px 8px rgb(0 0 0 / .24);
    font:700 11px/1 var(--annotation-sans);
    pointer-events:none;
    will-change:transform;
  }
  [hidden] { display:none !important; }
  @media (prefers-reduced-motion:reduce) {
    button { transition:none; }
  }
`;

const OVERLAY_MARKUP = `
  <style>${OVERLAY_STYLE}</style>
  <div class="layer badges"></div>
  <div class="outline" hidden></div>
  <div class="inspector" hidden>
    <div class="row head"><span class="key tag">div</span><span class="value size">0×0</span></div>
    <div class="rows"></div>
  </div>
  <section class="popover" role="dialog" aria-label="Annotate element" hidden>
    <span class="chip" aria-hidden="true">div</span>
    <textarea rows="1" maxlength="${GUEST_ANNOTATION_MAX_COMMENT_LENGTH}" placeholder="Add a comment…" aria-label="Annotation comment"></textarea>
    <button type="button" aria-label="Save annotation" title="Save annotation (Enter)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 19V5" /><path d="M5 12l7-7 7 7" />
      </svg>
    </button>
  </section>
  <div class="notice" role="status" aria-live="polite" hidden></div>
  <div class="cursor" hidden></div>
`;

function initializeOverlay(): void {
  if (host || !document.documentElement) return;
  host = document.createElement("div");
  host.setAttribute(HOST_ATTRIBUTE, "");
  host.style.cssText =
    "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;contain:layout style paint;";
  shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = OVERLAY_MARKUP;
  outline = shadow.querySelector(".outline");
  inspector = shadow.querySelector(".inspector");
  inspectorTag = shadow.querySelector(".inspector .tag");
  inspectorSize = shadow.querySelector(".inspector .size");
  inspectorRows = shadow.querySelector(".inspector .rows");
  popover = shadow.querySelector(".popover");
  popoverTag = shadow.querySelector(".popover .chip");
  textarea = shadow.querySelector("textarea");
  badgeLayer = shadow.querySelector(".badges");
  submitButton = shadow.querySelector("button");
  cursorBubble = shadow.querySelector(".cursor");
  notice = shadow.querySelector(".notice");
  document.documentElement.append(host);
  markerResizeObserver = new ResizeObserver(scheduleFrame);
  markerResizeObserver.observe(document.documentElement);

  new MutationObserver((records) => {
    if (projectedMarkers.length === 0) return;
    if (
      records.every(
        (record) =>
          record.target === host || (shadow !== null && record.target.getRootNode() === shadow),
      )
    ) {
      return;
    }
    invalidateMarkersSoon();
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["id", "role", "href", "type", "multiple", "size"],
    childList: true,
    subtree: true,
  });
  globalThis.addEventListener("popstate", handleHistoryNavigation);
  globalThis.addEventListener("hashchange", handleHistoryNavigation);
  sendReady();
}

ipcRenderer.on(BROWSER_ANNOTATION_GUEST_COMMAND_CHANNEL, (_event, rawCommand: unknown) => {
  if (!isGuestAnnotationCommand(rawCommand) || rawCommand.documentToken !== documentToken) return;
  initializeOverlay();
  if (rawCommand.kind === "start") {
    activeSession = { sessionId: rawCommand.sessionId };
    applyVisualTheme(rawCommand.theme);
    host?.setAttribute("data-interactive", "");
    setPageCursorHidden(true);
    clearSelection();
    hideNotice();
    inspectedElement = null;
    inspectedCard = null;
    scheduleFrame();
    return;
  }
  if (rawCommand.kind === "cancel") {
    if (activeSession?.sessionId === rawCommand.sessionId) endInteractiveSession(false);
    return;
  }
  if (rawCommand.kind === "refresh-document") {
    if (activeSession) endInteractiveSession(false);
    handleDocumentIdentityChange();
    return;
  }
  projectionVersion = rawCommand.projectionVersion;
  projectedMarkers = rawCommand.markers;
  projectionAckPending = true;
  markersNeedResolve = true;
  scheduleFrame();
});

// Preloads execute before page scripts. Install the capture boundary now, rather than at
// DOMContentLoaded, so an untrusted page cannot register an earlier listener for picker clicks or
// private comment input.
installInteractionListeners();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeOverlay, { once: true });
} else {
  initializeOverlay();
}
