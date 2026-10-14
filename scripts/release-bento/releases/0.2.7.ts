import {
  appIcon,
  copy,
  fileIcon,
  icon,
  loader,
  logo,
  stats,
  toggle,
  type IconName,
  type ReleaseBento,
} from "../kit.ts";

const benefit = (glyph: IconName, title: string, detail: string) =>
  `<div class="benefit"><span class="benefit-icon">${icon(glyph, 23)}</span><div><strong>${title}</strong><span>${detail}</span></div></div>`;

const performance = `
<section class="tile performance">
  ${copy("More flow. Less waiting.", "Faster starts, smoother long chats, and less CPU while your agents work.")}
  <div class="benefits">
    ${benefit("Rocket", "Get straight to work", "Your projects and chats appear sooner.")}
    ${benefit("Speed", "Stay in the flow", "Scroll and search through code-heavy replies.")}
    ${benefit("Cpu", "Keep things quiet", "A lighter app, even through long sessions.")}
  </div>
</section>`;

const composer = `
<section class="tile fill composer">
  ${copy("Your workspace, always in view", "More room to write. Project, branch and connection details stay above your message.")}
  <div class="conversation">
    <div class="reply-head">${logo("claude", 19)}<span>Claude</span></div>
    <p>The changes are ready. I updated the config and checked the build.</p>
    <div class="file-line"><span class="chip">${fileIcon("ts")}vite.config.ts</span><span class="dim">Updated</span></div>
  </div>
  <div class="composer-stage">
    <div class="context-bar"><span>${icon("Folder", 14)}Glade${icon("ChevronDown", 12)}</span><span>${icon("GitCommitHorizontal", 14)}main${icon("ChevronDown", 12)}</span><span class="grow"></span><span class="host"><i class="dot"></i>Studio Mac</span></div>
    <div class="message-field"><p>Let's polish the release notes.</p><div class="composer-footer">${icon("Plus", 16, "dim")}<span>Claude Opus 5.5</span>${icon("ChevronDown", 12, "dim")}<span class="grow"></span><span class="send">${icon("ArrowUp02", 16)}</span></div></div>
  </div>
</section>`;

const brand = (version: string) => `
<section class="tile brand app-brand">
  ${appIcon("dark", 180)}
  <div><div class="brand-name">Glade</div><div class="ver">${version}</div></div>
</section>`;

const tabs = `
<section class="tile tabs-tile">
  ${copy("Put tabs in their place", "Drag to reorder. Each chat remembers your layout.")}
  <div class="tab-stage">
    <div class="tab-strip"><span class="workspace-tab">${icon("Comment", 14)}Chat</span><span class="workspace-tab muted-tab">${fileIcon("ts")}config.ts</span><span class="workspace-tab">${icon("PlusMinusSquare", 14)}Review</span></div>
    <div class="drag-tab">${fileIcon("ts")}config.ts${icon("X", 12, "dim")}</div>
    <svg class="pointer" width="25" height="30" viewBox="0 0 25 30" fill="none"><path d="M3 2 21 17 12 18 8 27Z" fill="#eee" stroke="#161616" stroke-width="2" stroke-linejoin="round"/></svg>
    <div class="tab-hint">Your chat stays pinned.</div>
  </div>
</section>`;

const awake = `
<section class="tile fill awake">
  ${copy("Keep the screen with you", "Choose whether your display stays on while Keep Mac awake is active.")}
  <div class="awake-settings"><div class="setting"><span>Keep Mac awake</span><div class="seg"><span>Off</span><span class="on">While working</span><span>Always</span></div></div><div class="setting"><span>Keep display awake</span>${toggle(true)}</div></div>
</section>`;

const remote = `
<section class="tile remote">
  ${copy("Pick up where you left off", "Remote projects appear right away and refresh when your host reconnects.")}
  <div class="panel remote-panel">
    <div class="remote-host">${icon("ServerStack", 17)}<strong>Studio Mac</strong><span class="grow"></span><i class="dot"></i><span class="dim xs">Connected</span></div>
    <div class="project-row">${icon("ChevronDown", 12, "dim")}${icon("Folder", 15, "dim")}Glade<span class="grow"></span>${icon("Plus", 14, "dim")}</div>
    <div class="chat-row selected">Prepare the release<span class="grow"></span><span class="running">${loader("action", 14)}</span></div>
    <div class="chat-row dim">Review the latest changes</div>
  </div>
</section>`;

const tasks = `
<section class="tile fill tasks">
  ${copy("From task to tool call", "Click a background task to jump straight to its command and output.")}
  <div class="task-link">${icon("ComputerTerminal", 16, "dim")}Build desktop app<span class="grow"></span>${icon("ArrowUpRight", 16)}</div>
  <div class="task-connector"></div>
  <div class="panel task-detail"><div class="command">${icon("ComputerTerminal", 15, "dim")}<span>Ran</span><span class="mono">bun run build</span><span class="grow"></span>${icon("CircleCheck", 15, "ok")}</div><div class="output-label">Output</div><div class="pre">Build completed successfully.</div></div>
</section>`;

const bento: ReleaseBento = {
  css: `
.grid { grid-template-columns: 590px 420px 1fr; }
.performance { height: 430px; } .app-brand { height: 270px; } .tabs-tile { height: 320px; } .stats { height: 250px; } .remote { height: 330px; }
.performance header h2 { font-size: 34px; letter-spacing: -0.035em; }
.performance header p { max-width: 460px; }
.benefits { display: flex; flex-direction: column; gap: 12px; margin-top: 26px; }
.benefit { display: flex; align-items: center; gap: 14px; padding: 12px 14px; border-radius: 13px; border: 1px solid var(--border); background: var(--secondary); }
.benefit-icon { width: 40px; height: 40px; display: grid; place-items: center; color: var(--improved); border: 1px solid var(--border); border-radius: 11px; background: var(--tile); }
.benefit strong { display: block; font-size: 15px; font-weight: 550; } .benefit div > span { display: block; font-size: 13px; color: var(--muted); margin-top: 4px; }
.app-brand { flex-direction: row; gap: 8px; padding: 0 20px 0 4px; }
.app-brand img { flex: none; } .brand-name { font-size: 38px; font-weight: 600; letter-spacing: -0.025em; } .app-brand .ver { font-size: 84px; margin-top: 4px; }
.conversation { margin-top: 34px; padding: 0 8px; color: var(--fg-soft); font-size: 15px; line-height: 1.6; }
.reply-head { display: flex; align-items: center; gap: 9px; margin-bottom: 12px; font-weight: 550; }
.conversation p { max-width: 420px; } .file-line { display: flex; gap: 10px; align-items: center; margin-top: 18px; font-size: 12px; }
.composer-stage { position: absolute; left: 28px; right: 28px; bottom: 28px; }
.context-bar { display: flex; gap: 14px; align-items: center; padding: 10px 14px; background: var(--panel); border: 1px solid var(--border); border-radius: 14px 14px 0 0; font-size: 12px; margin: 0 7px; }
.context-bar > span { display: flex; align-items: center; gap: 6px; } .context-bar .host { color: var(--muted); font-size: 11px; }
.dot { width: 6px; height: 6px; background: var(--success); border-radius: 50%; flex: none; }
.message-field { border-radius: 16px; background: #242424; border: 1px solid var(--control); padding: 18px 16px 12px; box-shadow: var(--shadow); font-size: 14px; }
.composer-footer { margin-top: 42px; display: flex; align-items: center; gap: 9px; font-size: 12px; color: var(--fg-soft); }
.send { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; color: var(--tile); background: var(--fg); }
.tab-stage { margin-top: 30px; position: relative; }
.tab-strip { display: flex; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 8px; gap: 3px; }
.workspace-tab { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 7px 10px; white-space: nowrap; }
.workspace-tab + .workspace-tab { border-left: 1px solid var(--control); } .muted-tab { opacity: .25; }
.drag-tab { display: flex; align-items: center; gap: 8px; position: absolute; right: 3px; top: 25px; padding: 11px 13px; transform: rotate(-6deg); border-radius: 9px; border: 1px solid var(--control); background: #292929; box-shadow: 0 12px 24px #0008; font-size: 13px; }
.pointer { position: absolute; right: 25px; top: 51px; filter: drop-shadow(0 2px 2px #0008); }
.tab-hint { color: var(--faint); font-size: 12px; margin-top: 44px; }
.awake-settings { margin-top: 26px; border: 1px solid var(--border); border-radius: 13px; padding: 0 14px; background: var(--panel); }
.setting { display: flex; justify-content: space-between; gap: 12px; align-items: center; min-height: 53px; font-size: 13px; } .setting + .setting { border-top: 1px solid var(--border); } .awake-settings .setting:first-child { align-items: stretch; flex-direction: column; gap: 9px; padding: 12px 0; } .awake-settings .seg { font-size: 11px; }
.remote-panel { left: 28px; right: 28px; top: 140px; padding: 15px 15px 12px; }
.remote-host { display: flex; align-items: center; gap: 8px; font-size: 13px; padding-bottom: 12px; border-bottom: 1px solid var(--border); } .remote-host strong { font-weight: 550; }
.project-row { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-top: 12px; padding: 0 4px 7px; }
.chat-row { display: flex; align-items: center; padding: 8px 10px 8px 28px; font-size: 13px; border-radius: 7px; } .chat-row.selected { background: var(--secondary); }
.task-link { display: flex; align-items: center; gap: 9px; margin-top: 24px; background: var(--secondary); border: 1px solid var(--control); padding: 12px 14px; border-radius: 11px; font-size: 13px; }
.task-connector { height: 18px; border-left: 1px solid var(--rail); margin-left: 22px; }
.task-detail { position: static; padding: 14px; border-color: rgb(125 211 252 / 20%); }
.command { display: flex; align-items: center; gap: 8px; font-size: 12px; } .command > span:first-of-type { color: var(--muted); }
.output-label { margin-top: 15px; margin-bottom: 7px; font-size: 11px; color: var(--muted); }
`,
  render: ({ version, counts }) => `
<div class="col">${performance}${composer}</div>
<div class="col">${brand(version)}${tabs}${awake}</div>
<div class="col">${stats(counts)}${remote}${tasks}</div>`,
};

export default bento;
