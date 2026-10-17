import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appIcon, copy, icon, loader, logo, toggle, type ReleaseBento } from "../kit.ts";

const landingArtwork = `data:image/webp;base64,${readFileSync(join(import.meta.dirname, "../../../apps/web/public/artwork/landing-dark.webp")).toString("base64")}`;

const look = `
<section class="tile look">
  <img class="look-art" src="${landingArtwork}" alt="">
  ${copy("A fresh coat of dusk", "A quieter violet accent, warmer light mode and new artwork from the first screen.")}
  <div class="palette"><span class="swatch" style="background:#9387e0"></span><span class="swatch" style="background:#5d50bd"></span><span class="swatch" style="background:#f3efe7"></span><span class="dim">Dusk violet</span></div>
</section>`;

const AGENTS = [
  ["openai", "Codex", "Signed in", true],
  ["claude", "Claude", "Signed in", true],
  ["cursor", "Cursor", "Sign in", false],
] as const;

const setup = `
<section class="tile fill setup">
  ${copy("Set up in one pass", "Pick your agents, sign in right there, then start your first chat.")}
  <div class="panel agent-list">
    ${AGENTS.map(
      ([id, name, state, on]) =>
        `<div class="agent-row">${logo(id, 20)}<span>${name}</span><span class="grow"></span>${on ? `<span class="signed">${icon("CircleCheck", 13)}${state}</span>` : `<span class="btn sm">${state}</span>`}${toggle(on)}</div>`,
    ).join("")}
  </div>
  <div class="first-chat"><span class="dim">All set.</span><span class="grow"></span><span class="btn primary">Start your first chat ${icon("ArrowRight02", 13)}</span></div>
</section>`;

const brand = (version: string) => `
<section class="tile brand app-brand">
  ${appIcon(180)}<div><div class="brand-name">Glade</div><div class="ver">${version}</div></div>
</section>`;

const resume = `
<section class="tile fill resume">
  ${copy("Picks up where it stopped", "Dropped connections, provider hiccups and a sleeping Mac no longer end the turn.")}
  <div class="panel timeline">
    <div class="event">${icon("AlertCircle", 15, "warn")}<div><strong>Connection dropped</strong><span class="dim">Provider returned a temporary error</span></div></div>
    <div class="event">${loader("action", 15)}<div><strong>Continuing on its own</strong><span class="dim">Waiting a moment before retrying</span></div></div>
    <div class="event">${icon("RefreshCw", 15, "accent")}<div><strong>Mac woke up</strong><span class="dim">The chat resumed</span></div></div>
    <div class="event done">${icon("CircleCheck", 15, "ok-ic")}<div><strong>Turn finished</strong><span class="dim">Nothing lost along the way</span></div></div>
  </div>
  <div class="panel long-run">${icon("ComputerTerminal", 15, "dim")}<span class="mono">bun run build --watch</span><span class="grow"></span><span class="live"><i></i>Still running</span></div>
  <div class="panel long-run">${icon("Speed", 15, "dim")}<span>Agent went quiet</span><span class="grow"></span><span class="dim">Turn ended on its own</span></div>
</section>`;

const stat = (category: string, glyph: "Bug" | "Sparkles", value: number, label: string) =>
  `<div class="stat stat-${category}"><span class="stat-ic">${icon(glyph, 22)}</span><div class="num">${value}</div><div class="lbl">${label}</div></div>`;

const warmup = `
<section class="tile warmup">
  ${copy("Claude, ready before you are", "Claude gets ready while you type, so the first reply lands sooner.")}
  <div class="panel composer">
    <p>Refactor the settings loader<span class="caret"></span></p>
    <div class="composer-footer">${logo("claude", 15)}<span>Claude</span><span class="grow"></span><span class="warming">${loader("action", 13)}Getting ready</span><span class="send">${icon("ArrowUp02", 15)}</span></div>
  </div>
</section>`;

const skills = `
<section class="tile fill skill-rows">
  ${copy("Know what your agent used", "Skill loads and MCP tools show by name, whichever provider runs them.")}
  <div class="panel rows">
    <div class="tool-row">${icon("ChevronRight", 12, "dim")}${icon("Sparkles", 15, "accent")}Loaded skill<span class="chip">frontend-design</span></div>
    <div class="tool-row">${icon("ChevronRight", 12, "dim")}${icon("Sparkles", 15, "accent")}Loaded skill<span class="chip">release-notes</span></div>
    <div class="tool-row">${icon("ChevronRight", 12, "dim")}${logo("linear", 15)}Linear<span class="chip">create_issue</span><span class="grow"></span><span class="dim xs">MCP</span></div>
  </div>
</section>`;

const bento: ReleaseBento = {
  css: `
:root { --violet: #9387e0; }
.grid { grid-template-columns: 560px 430px 1fr; }
.look { height: 560px; } .app-brand { height: 270px; } .stats { height: 250px; } .warmup { height: 290px; }
.look { display: flex; flex-direction: column; justify-content: flex-end; }
.look-art { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 40% 50%; }
.look::after { content: ""; position: absolute; inset: 0; background: linear-gradient(transparent 30%, rgb(22 22 22 / 92%) 82%), linear-gradient(135deg, rgb(147 135 224 / 22%), transparent 60%); }
.look header, .look .palette { position: relative; z-index: 1; }
.look header h2 { font-size: 34px; letter-spacing: -0.03em; }
.look header p { color: var(--fg-soft); }
.palette { display: flex; align-items: center; gap: 9px; margin-top: 20px; font-size: 13px; }
.swatch { width: 26px; height: 26px; border-radius: 8px; border: 1px solid rgb(255 255 255 / 18%); }
.palette .dim { margin-left: 6px; }
.agent-list { position: static; margin-top: 22px; padding: 4px 16px; border-radius: 16px; }
.agent-row { display: flex; align-items: center; gap: 12px; min-height: 58px; font-size: 14px; }
.agent-row + .agent-row { border-top: 1px solid var(--border); }
.signed { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--success); margin-right: 6px; }
.agent-row .btn { margin-right: 6px; }
.switch.on { background: var(--violet); }
.app-brand { flex-direction: row; gap: 6px; padding: 0 20px 0 4px; } .app-brand img { flex: none; }
.brand-name { font-size: 38px; font-weight: 600; letter-spacing: -.025em; } .app-brand .ver { font-size: 84px; margin-top: 4px; }
.timeline { position: static; margin-top: 26px; padding: 8px 18px; border-radius: 16px; }
.event { position: relative; display: flex; gap: 14px; padding: 20px 0; font-size: 14px; }
.event + .event::before { content: ""; position: absolute; left: 7px; top: -9px; height: 18px; border-left: 1px dashed var(--control); }
.event .ic { margin-top: 2px; }
.event strong { display: block; font-weight: 500; } .event .dim { font-size: 12px; }
.warn { color: var(--fixed); } .accent { color: var(--violet); } .event .ic:not(.warn):not(.accent):not(.ok-ic) { color: var(--violet); } .ok-ic { color: var(--success); }
.stats { grid-template-columns: repeat(2, 1fr); }
.composer { position: static; margin-top: 24px; padding: 16px; border-radius: 16px; font-size: 14px; }
.caret { display: inline-block; width: 2px; height: 17px; margin-left: 2px; vertical-align: -3px; background: var(--violet); }
.composer-footer { display: flex; align-items: center; gap: 8px; margin-top: 40px; font-size: 12px; }
.warming { display: flex; align-items: center; gap: 7px; padding: 5px 10px; border-radius: 999px; background: rgb(147 135 224 / 14%); color: var(--violet); }
.send { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--fg); color: var(--tile); }
.first-chat { display: flex; align-items: center; margin-top: 18px; font-size: 13px; }
.btn.primary { display: flex; align-items: center; gap: 7px; background: var(--violet); color: #15131f; font-weight: 600; }
.long-run { position: static; display: flex; align-items: center; gap: 10px; margin-top: 12px; padding: 17px 16px; border-radius: 14px; font-size: 12px; }
.mono { font-family: "JetBrains Mono Variable", monospace; }
.live { display: flex; align-items: center; gap: 7px; color: var(--running); } .live i { width: 7px; height: 7px; border-radius: 50%; background: var(--running); }
.rows { position: static; margin-top: 20px; padding: 4px 14px; border-radius: 14px; }
.tool-row { display: flex; align-items: center; gap: 8px; min-height: 50px; font-size: 13px; }
.tool-row + .tool-row { border-top: 1px solid var(--border); }
`,
  render: ({ version, counts }) => `
<div class="col">${look}${setup}</div>
<div class="col">${brand(version)}${resume}</div>
<div class="col"><section class="tile stats">${stat("fixed", "Bug", counts.Fixed, counts.Fixed === 1 ? "fix" : "fixes")}${stat("improved", "Sparkles", counts.Improved, counts.Improved === 1 ? "improvement" : "improvements")}</section>${warmup}${skills}</div>`,
};

export default bento;
