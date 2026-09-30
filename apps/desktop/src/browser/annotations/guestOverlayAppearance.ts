export const COMMENT_MAX_HEIGHT = 112;
import "../webMcp/guestBridge";
import { GUEST_ANNOTATION_MAX_COMMENT_LENGTH } from "./guestProtocol";
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

export const OVERLAY_MARKUP = `
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
