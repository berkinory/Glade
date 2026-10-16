import {
  appIcon,
  copy,
  fileIcon,
  icon,
  loader,
  logo,
  stats,
  toggle,
  type ReleaseBento,
} from "../kit.ts";

const PROVIDERS: ReadonlyArray<readonly [string, string, boolean]> = [
  ["openai", "Codex", false],
  ["claude", "Claude", false],
  ["opencodeai", "OpenCode", true],
  ["xaigrok", "Grok Build", true],
  ["cursor", "Cursor", true],
];

const modelRow = (name: string, detail: string, starred = false) =>
  `<div class="model"><span>${name}</span><span class="dim">${detail}</span><span class="grow"></span><span class="${starred ? "star on" : "star"}">${icon("Star", 14)}</span></div>`;

const providers = `
<section class="tile hero">
  ${copy("Five providers, one Glade", "OpenCode, Grok Build and Cursor join Codex and Claude, with their own models, effort levels and slash commands.")}
  <div class="logos">
    ${PROVIDERS.map(
      ([mark, name, added]) =>
        `<div class="logo-cell${added ? " added" : ""}">${logo(mark, 34)}<span>${name}</span>${added ? '<i class="new-dot"></i>' : ""}</div>`,
    ).join("")}
  </div>
  <div class="panel picker">
    <div class="tabs">
      <span class="tab">${icon("Star", 15)}</span>
      ${(["openai", "claude", "cursor", "xaigrok", "opencodeai"] as const)
        .map(
          (mark) =>
            `<span class="tab${mark === "cursor" ? " active" : ""}">${logo(mark, 15)}</span>`,
        )
        .join("")}
      <span class="tab">${icon("Plus", 15)}</span>
    </div>
    <div class="search">${icon("Search", 14, "faint")}<span class="faint">Search models…</span></div>
    <div class="group">Cursor</div>
    ${modelRow("Composer 2", "Fast", true)}
    <div class="group">Anthropic</div>
    ${modelRow("Claude Opus 5.5", "High · Thinking On")}
    <div class="group">OpenAI</div>
    ${modelRow("GPT-5.5", "High")}
    <div class="group">Google</div>
    ${modelRow("Gemini 3 Pro", "High")}
  </div>
</section>`;

const update = `
<section class="tile fill update">
  ${copy("Update everything at once", "One button updates provider CLIs here and on every connected host, then Glade itself.")}
  <div class="update-stage">
    <div class="footer-mock">
      <div class="tooltip">Updates Glade 0.2.6, Codex and Claude on this computer. Glade restarts when done.</div>
      <div class="footer-row">${icon("Settings01", 15, "dim")}<span class="dim">Settings</span><span class="grow"></span><span class="update-pill">Update all</span><span class="dim">${icon("HelpCircle", 15)}</span></div>
    </div>
    <div class="panel mini-dialog">
      <div class="d-title">Chats are still running</div>
      <p class="d-body">Work in progress will stop while Glade restarts to update.</p>
      <div class="check-row"><span class="checkbox">${icon("Tick", 11)}</span>Resume chats automatically</div>
      <div class="d-actions"><span class="btn">Cancel</span><span class="btn primary">Update</span></div>
    </div>
  </div>
</section>`;

const PERF: ReadonlyArray<readonly [Parameters<typeof icon>[0], string]> = [
  ["Rocket", "Starts and opens chats faster"],
  ["Cpu", "Uses much less memory"],
  ["Speed", "Streams long chats smoothly"],
  ["Database", "Far less database and disk work"],
];

const performance = `
<section class="tile perf">
  ${copy("Faster and lighter", "Quicker to start, lighter on memory, and calm through long turns.")}
  <div class="perf-list">${PERF.map(([glyph, label]) => `<div class="perf-row">${icon(glyph, 17)}<span>${label}</span></div>`).join("")}</div>
</section>`;

const brand = (version: string) => `
<section class="tile brand app-brand">
  ${appIcon(190)}
  <div class="brand-text"><div class="brand-name">Glade</div><div class="ver">${version}</div></div>
</section>`;

const usage = `
<section class="tile fill usage">
  ${copy("Picks up after usage limits", "A chat stopped by a usage limit continues on its own once the limit resets.")}
  <div class="banner">${icon("AlertCircle", 15)}<span>Usage limit reached. Continuing automatically at 14:30.</span><span class="grow"></span><span class="btn sm">Cancel</span></div>
  <div class="setting"><div><div>Continue after usage limits</div><div class="dim xs">When a usage limit stops a chat, continue it automatically once the limit resets.</div></div>${toggle(true)}</div>
</section>`;

const taskRow = (name: string, elapsed: string, status: string) =>
  `<div class="task"><span>${name}</span><span class="elapsed">${elapsed}</span><span class="grow"></span>${status}</div>`;

const environment = `
<section class="tile environment">
  ${copy("Background tasks in view", "See what each chat left running, how long it has run, and stop it.")}
  <div class="panel env-panel">
    <div class="env-head">Background tasks (3)</div>
    ${taskRow("bun run test --watch", "3m 12s", `<span class="running">${loader("action", 14)}</span>`)}
    ${taskRow("Build desktop app", "1m 4s", '<i class="dot finished"></i>')}
    ${taskRow("Typecheck web", "12s", '<i class="dot failed"></i>')}
    <div class="env-row">${icon("Globe", 15, "dim")}<span>Local Servers</span><span class="grow"></span><i class="dot ok-dot"></i><span>1</span>${icon("ChevronDown", 13, "faint")}</div>
    <div class="servers">
      <div class="servers-head"><span class="dim">1 server running</span><span class="grow"></span>${icon("RefreshCw", 13, "faint")}</div>
      <div class="server"><i class="dot ring"></i><div><div>Vite</div><div class="dim xs">localhost:5173 · glade</div><div class="dim xs">Started by this chat · bun run dev</div></div><span class="grow"></span><span class="stop">${icon("Square", 12)}</span></div>
    </div>
  </div>
</section>`;

const command = (
  glyph: Parameters<typeof icon>[0],
  verb: string,
  target: string,
  outcome: string,
) =>
  `<div class="trow">${icon(glyph, 15, "dim")}<span class="dim">${verb}</span>${target}<span class="outcome">${outcome}</span></div>`;

const toolRows = `
<section class="tile fill tool-rows">
  ${copy("Commands that say how they went", "Test totals, lint errors and search matches, right on the row.")}
  <div class="panel rows-panel">
    ${command("ComputerTerminal", "Ran", '<span class="mono">bun run test</span><span class="times">×3</span>', '<span class="bad">1 failed</span>, 395 passed')}
    ${command("ComputerTerminal", "Ran", '<span class="mono">bunx oxlint src</span>', '<span class="bad">3 errors</span>, 2 warnings')}
    ${command("Search", "Searched for", "<span>pairingToken in server/src +2</span>", "6 matches in 3 files")}
    ${command("File02", "Read", `<span class="chip">${fileIcon("ts")}pairingTokens.ts</span>`, "L20–40")}
  </div>
</section>`;

const bento: ReleaseBento = {
  css: `
.grid { grid-template-columns: 600px 420px 1fr; }
.hero { height: 640px; } .perf { height: 330px; } .app-brand { height: 270px; } .stats { height: 250px; } .environment { height: 440px; }

.btn.primary { background: var(--fg); color: var(--tile); border-color: transparent; font-weight: 600; }
.d-title { font-size: 15px; font-weight: 600; }
.d-body { color: var(--muted); font-size: 12.5px; line-height: 1.45; margin-top: 5px; }
.d-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.dot { display: block; width: 7px; height: 7px; border-radius: 50%; flex: none; }
.dot.finished { background: rgb(110 231 183 / 80%); } .dot.failed { background: rgb(253 164 175 / 90%); }
.dot.ok-dot { background: var(--success); }
.dot.ring { width: 10px; height: 10px; background: var(--success); box-shadow: 0 0 0 3px rgb(83 204 164 / 25%); margin: 5px 3px 0; align-self: flex-start; }

.logos { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-top: 22px; }
.logo-cell { position: relative; display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 20px 0 14px; border-radius: 14px; background: var(--secondary); border: 1px solid var(--border); font-size: 13.5px; color: var(--muted); }
.logo-cell .ic { color: var(--fg); }
.logo-cell.added { color: var(--fg-soft); }
.new-dot { position: absolute; top: 8px; right: 8px; width: 6px; height: 6px; border-radius: 50%; background: var(--new); }
.picker { left: 28px; right: -20px; top: 284px; bottom: -20px; padding: 0 36px 12px 0; }
.tabs { display: flex; gap: 2px; padding: 6px 10px 0; border-bottom: 1px solid var(--border); }
.tab { display: grid; place-items: center; width: 34px; height: 34px; color: var(--muted); position: relative; }
.tab .ic { color: var(--fg); }
.tab:first-child .ic, .tab:last-child .ic { color: var(--muted); }
.tab.active::after { content: ""; position: absolute; left: 7px; right: 7px; bottom: -1px; height: 2px; border-radius: 2px; background: var(--fg); }
.search { display: flex; align-items: center; gap: 8px; margin: 10px 14px 4px; padding: 0 10px; height: 32px; border-radius: 9px; background: var(--inset); border: 1px solid var(--border); font-size: 13px; }
.group { padding: 10px 24px 4px; font-size: 11.5px; font-weight: 600; color: var(--faint); letter-spacing: 0.02em; }
.model { display: flex; align-items: center; gap: 10px; height: 32px; margin: 0 14px; padding: 0 10px; border-radius: 8px; font-size: 13.5px; }
.model .dim { font-size: 12.5px; }
.model:nth-of-type(2) { background: var(--secondary); }
.star { color: var(--faint); } .star.on { color: var(--fixed); }

.update-stage { display: flex; gap: 14px; margin-top: 22px; align-items: flex-end; }
.footer-mock { flex: 1; display: flex; flex-direction: column; gap: 10px; }
.tooltip { align-self: flex-end; max-width: 250px; padding: 8px 10px; border-radius: 9px; background: var(--fg); color: var(--tile); font-size: 12px; line-height: 1.4; }
.footer-row { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px; border-radius: 12px; background: var(--panel); border: 1px solid var(--border); font-size: 13px; }
.update-pill { height: 24px; padding: 0 11px; border-radius: 999px; background: #3b82f6; color: #fff; font-size: 12px; font-weight: 500; display: inline-flex; align-items: center; }
.mini-dialog { position: static; width: 260px; padding: 14px; border-radius: 16px; }
.check-row { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 13px; }
.checkbox { display: grid; place-items: center; width: 16px; height: 16px; border-radius: 4px; background: var(--fg); color: var(--tile); }

.perf-list { display: flex; flex-direction: column; gap: 6px; margin-top: 18px; }
.perf-row { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 12px; background: var(--secondary); border: 1px solid var(--border); font-size: 13.5px; }
.perf-row .ic { color: var(--improved); }

.app-brand { flex-direction: row; gap: 12px; padding: 0 26px 0 6px; }
.app-brand img { flex: none; margin: -12px 0; }
.brand-text { display: flex; flex-direction: column; }
.brand-name { font-size: 38px; font-weight: 600; letter-spacing: -0.025em; }
.app-brand .ver { font-size: 84px; margin-top: 4px; }

.banner { display: flex; align-items: center; gap: 9px; margin-top: 20px; padding: 10px 12px; border-radius: 12px; font-size: 13px; color: #93c5fd; background: rgb(59 130 246 / 10%); border: 1px solid rgb(59 130 246 / 25%); }
.banner span:not(.btn) { color: var(--fg-soft); }
.setting { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 12px; padding: 12px 14px; border-radius: 12px; background: var(--panel); border: 1px solid var(--border); font-size: 13.5px; line-height: 1.4; }

.env-panel { left: 28px; right: -20px; top: 140px; bottom: -20px; padding: 12px 36px 12px 16px; }
.env-head { font-size: 13px; font-weight: 600; color: var(--fg-soft); margin-bottom: 4px; }
.task { display: flex; align-items: center; gap: 8px; height: 30px; font-size: 13px; }
.elapsed { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.env-row { display: flex; align-items: center; gap: 8px; height: 36px; margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--border); font-size: 13.5px; }
.servers { margin-top: 6px; padding: 10px 12px; border-radius: 12px; background: var(--tile); border: 1px solid var(--border); }
.servers-head { display: flex; align-items: center; font-size: 12.5px; margin-bottom: 8px; }
.server { display: flex; gap: 10px; font-size: 13px; line-height: 1.45; }
.stop { color: var(--muted); align-self: center; }

.rows-panel { left: 28px; right: -20px; top: 112px; bottom: -20px; padding: 10px 36px 10px 16px; }
.trow { display: flex; align-items: center; gap: 8px; height: 30px; font-size: 13.5px; white-space: nowrap; }
.times { font-size: 12px; color: var(--muted); }
.outcome { margin-left: 4px; font-size: 12.5px; color: var(--muted); }
`,
  render: ({ version, counts }) => `
<div class="col">${providers}${update}</div>
<div class="col">${performance}${brand(version)}${usage}</div>
<div class="col">${stats(counts)}${environment}${toolRows}</div>`,
};

export default bento;
