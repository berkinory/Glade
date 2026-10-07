import type { CdpSession } from "./cdpSession";

// Vendor challenge frames, matched on the frame URL. The vendor is named by the matched
// signature, never by the host name, which can carry a tenant or a token.
const VENDORS: ReadonlyArray<readonly [RegExp, string]> = [
  [/turnstile|challenges\.cloudflare\.com/iu, "Cloudflare Turnstile"],
  [/recaptcha/iu, "reCAPTCHA"],
  [/hcaptcha/iu, "hCaptcha"],
  [/arkoselabs|funcaptcha/iu, "Arkose"],
  [/datadome|captcha-delivery\.com/iu, "DataDome"],
  [/perimeterx|px-cloud\.net|px-captcha/iu, "PerimeterX"],
  [/captcha/iu, "CAPTCHA"],
];
// Invisible-mode widgets (reCAPTCHA v3 badges, invisible hCaptcha) never ask the user anything.
const INVISIBLE = /[?&]size=invisible\b/iu;
// A widget preloads as a placeholder (1x1 or collapsed) and grows when it challenges; below this
// many on-screen CSS pixels it is not asking anything yet.
const MIN_AREA = 1_000;
const VISIBLE = `function () {
  return !this.checkVisibility || this.checkVisibility({ opacityProperty: true, visibilityProperty: true });
}`;

interface FrameTree {
  readonly frame: { readonly id: string; readonly url: string };
  readonly childFrames?: readonly FrameTree[];
}

function vendorOf(url: string): string | null {
  if (!url || INVISIBLE.test(url)) return null;
  return VENDORS.find(([pattern]) => pattern.test(url))?.[1] ?? null;
}

interface Frame {
  readonly id: string;
  readonly url: string;
}

// Same-process frames come from the main frame tree; out-of-process frames are left out of it and
// come from their auto-attached targets. Only frames whose owner is in the main renderer are
// measured, since their boxes are in main viewport coordinates.
async function frames(cdp: CdpSession): Promise<Frame[]> {
  const { frameTree } = await cdp.send<{ frameTree: FrameTree }>("Page.getFrameTree");
  const found: Frame[] = [];
  const walk = (node: FrameTree) => {
    for (const child of node.childFrames ?? []) {
      if (child.frame.url) found.push({ id: child.frame.id, url: child.frame.url });
      walk(child);
    }
  };
  walk(frameTree);
  const remote = await Promise.all(
    cdp
      .childTargets()
      .filter((child) => child.parentSessionId === undefined)
      .map(async (child) => ({
        id: child.targetId,
        url: await cdp
          .send<{ targetInfo: { url: string } }>("Target.getTargetInfo", {
            targetId: child.targetId,
          })
          .then(({ targetInfo }) => targetInfo.url)
          .catch(() => ""),
      })),
  );
  return [...found, ...remote];
}

async function onScreenArea(cdp: CdpSession, frameId: string, viewport: { w: number; h: number }) {
  const { backendNodeId } = await cdp.send<{ backendNodeId: number }>("DOM.getFrameOwner", {
    frameId,
  });
  const { object } = await cdp.send<{ object: { objectId: string } }>("DOM.resolveNode", {
    backendNodeId,
  });
  const { result } = await cdp.send<{ result: { value?: boolean } }>("Runtime.callFunctionOn", {
    objectId: object.objectId,
    functionDeclaration: VISIBLE,
    returnByValue: true,
  });
  if (!result.value) return 0;
  const { model } = await cdp.send<{ model: { border: readonly number[] } }>("DOM.getBoxModel", {
    backendNodeId,
  });
  const xs = [0, 2, 4, 6].map((index) => model.border[index]!);
  const ys = [1, 3, 5, 7].map((index) => model.border[index]!);
  const width = Math.max(0, Math.min(Math.max(...xs), viewport.w) - Math.max(Math.min(...xs), 0));
  const height = Math.max(0, Math.min(Math.max(...ys), viewport.h) - Math.max(Math.min(...ys), 0));
  return width * height;
}

// The vendor of a challenge frame showing on screen in the main frame's viewport, or null. Glade
// never interacts with it; the result tells the model to hand the page to the user.
export async function visibleChallenge(cdp: CdpSession): Promise<string | null> {
  const candidates = (await frames(cdp))
    .map((frame) => ({ ...frame, vendor: vendorOf(frame.url) }))
    .filter((frame) => frame.vendor !== null);
  if (candidates.length === 0) return null;
  const { cssLayoutViewport } = await cdp.send<{
    cssLayoutViewport: { clientWidth: number; clientHeight: number };
  }>("Page.getLayoutMetrics");
  const viewport = { w: cssLayoutViewport.clientWidth, h: cssLayoutViewport.clientHeight };
  for (const frame of candidates) {
    const area = await onScreenArea(cdp, frame.id, viewport).catch(() => 0);
    if (area >= MIN_AREA) return frame.vendor;
  }
  return null;
}
