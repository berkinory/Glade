import type {
  BrowserAnnotation,
  BrowserAnnotationSource,
} from "@glade/contracts/browser/browserAnnotations";
import { sanitizeBrowserAnnotationUrl } from "@glade/shared/browser/browserAnnotations";
import "../webMcp/guestBridge";
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
} from "./guestProtocol";
const FINGERPRINT_SEPARATOR = String.fromCharCode(31);

function normalizedText(value: string, maximumLength: number): string {
  return value
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

export function currentSource(): BrowserAnnotationSource {
  return {
    url: sanitizeBrowserAnnotationUrl(new URL(globalThis.location.href).href),
    pageTitle: normalizedText(document.title, GUEST_ANNOTATION_MAX_PAGE_TITLE_LENGTH),
  };
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

export function elementFingerprint(element: Element): string {
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

export function annotationSelectorFor(element: Element): string | null {
  if (currentSource().url.length > GUEST_ANNOTATION_MAX_URL_LENGTH) return null;
  return uniqueSelector(element);
}

export function describeElement(element: Element, comment: string): BrowserAnnotation | null {
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
