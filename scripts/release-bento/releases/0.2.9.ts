import { appIcon, copy, fileIcon, icon, logo, stats, toggle, type ReleaseBento } from "../kit.ts";

const SERVICES = ["supabase", "linear", "notion", "github", "figma", "slack", "vercel", "sentry"];

const mcp = `
<section class="tile mcp">
  ${copy("Connect once. Every agent.", "Add MCP servers in Glade and their tools are ready in every new chat, whichever provider runs it.")}
  <div class="service-grid">${SERVICES.map((id) => `<span class="service">${logo(id, 30)}</span>`).join("")}</div>
  <div class="panel server-list">
    <div class="server-row">${logo("linear", 20)}<div><strong>Linear</strong><span class="dim">Issues, projects and cycles</span></div><span class="grow"></span><span class="connected"><i></i>Connected</span></div>
    <div class="server-row">${logo("supabase", 20)}<div><strong>Supabase</strong><span class="dim">Codex and Claude</span></div><span class="grow"></span><span class="connected"><i></i>Connected</span></div>
    <div class="server-row">${logo("notion", 20)}<div><strong>Notion</strong><span class="dim">Docs and wikis</span></div><span class="grow"></span><span class="btn">Connect</span></div>
  </div>
</section>`;

const skills = `
<section class="tile fill skills">
  ${copy("Skills, checked before they land", "Install from skills.sh or GitHub after a look at the source, scripts and audits.")}
  <div class="panel skill-card">
    <div class="skill-head">${logo("hyperframes", 22)}<div><strong>hyperframes-cli</strong><span class="dim">skills.sh</span></div><span class="grow"></span><span class="btn primary">Install</span></div>
    <div class="audits"><span class="audit">${icon("CircleCheck", 13)}Source reviewed</span><span class="audit">${icon("CircleCheck", 13)}Scripts listed</span><span class="audit">${icon("CircleCheck", 13)}Audit passed</span></div>
    <div class="agents"><span class="dim">For</span><span class="agent on">${logo("openai", 14)}Codex</span><span class="agent on">${logo("claude", 14)}Claude</span><span class="agent">${logo("cursor", 14)}Cursor</span></div>
  </div>
  <div class="found">${icon("Sparkles", 15)}<span>Skills and MCP servers your agents added on their own show up here too.</span><span class="grow"></span><span class="use-all">Use everywhere</span></div>
</section>`;

const brand = (version: string) => `
<section class="tile brand app-brand">
  ${appIcon(180)}<div><div class="brand-name">Glade</div><div class="ver">${version}</div></div>
</section>`;

const BARS = [38, 52, 47, 66, 74, 88];

const visuals = `
<section class="tile fill visuals">
  ${copy("Replies you can play with", "Native charts, tables and checklists, with sliders that update the numbers as you move them.")}
  <div class="panel visual-card">
    <div class="visual-title">Monthly runway<span class="grow"></span><span class="figure">14.2 months</span></div>
    <div class="bars">${BARS.map((height) => `<span style="height:${height}%"></span>`).join("")}</div>
    <div class="slider-row"><span class="dim">Hiring pace</span><span class="slider"><i></i></span><span>3 / mo</span></div>
    <div class="slider-row"><span class="dim">Include contractors</span><span class="grow"></span>${toggle(true)}</div>
  </div>
  <div class="choices"><span class="choice">Compare with last year</span><span class="choice">Export as table</span></div>
</section>`;

const ROWS = [
  ["Ada", "Paris", "41"],
  ["Linus", "Helsinki", "38"],
  ["Grace", "New York", "52"],
];

const FORMATS = [
  ["video", "mp4"],
  ["audio", "m4a"],
  ["patch", "patch"],
  ["svg", "svg"],
] as const;

const previews = `
<section class="tile previews">
  ${copy("Preview more files", "Video, audio, HTML, CSV tables, JSON trees, patches and SVG.")}
  <div class="panel csv">
    <div class="csv-tab">${fileIcon("csv")}team.csv<span class="grow"></span><span class="dim xs">Table</span></div>
    <div class="csv-row head"><span>name</span><span>city</span><span>age ${icon("ArrowDown02", 11)}</span></div>
    ${ROWS.map((row) => `<div class="csv-row">${row.map((cell) => `<span>${cell}</span>`).join("")}</div>`).join("")}
  </div>
  <div class="formats">${FORMATS.map(([symbol, ext]) => `<span class="chip">${fileIcon(symbol)}.${ext}</span>`).join("")}</div>
</section>`;

const updates = `
<section class="tile fill updates">
  ${copy("All your updates, one window", "Glade and every provider, here and on your SSH hosts. Restart when you choose.")}
  <div class="panel update-list">
    <div class="update-row">${appIcon(20)}<span>Glade</span><span class="grow"></span><span class="dim xs">This Mac</span><span class="check on">${icon("Tick", 11)}</span></div>
    <div class="update-row">${logo("claude", 18)}<span>Claude Code</span><span class="grow"></span><span class="dim xs">build-box</span><span class="check on">${icon("Tick", 11)}</span></div>
    <div class="update-row">${logo("openai", 18)}<span>Codex</span><span class="grow"></span><span class="dim xs">This Mac</span><span class="check"></span></div>
  </div>
</section>`;

const bento: ReleaseBento = {
  css: `
.grid { grid-template-columns: 560px 430px 1fr; }
.mcp { height: 490px; } .found { display: flex; align-items: center; gap: 10px; margin-top: 20px; padding: 14px; border-radius: 13px; border: 1px dashed var(--control); font-size: 12px; color: var(--fg-soft); }
.found > span:nth-child(2) { max-width: 270px; line-height: 1.45; } .found .ic { color: var(--new); }
.use-all { padding: 5px 10px; border-radius: 999px; background: var(--seg-on); white-space: nowrap; }
.app-brand { height: 270px; } .stats { height: 250px; } .previews { height: 345px; }
.mcp header h2 { font-size: 32px; letter-spacing: -0.03em; }
.service-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 10px; margin-top: 26px; }
.service { display: grid; place-items: center; aspect-ratio: 1; border-radius: 13px; background: var(--panel); border: 1px solid var(--border); }
.server-list { position: static; margin-top: 18px; padding: 6px 16px; border-radius: 16px; }
.server-row { display: flex; align-items: center; gap: 12px; min-height: 62px; font-size: 14px; }
.server-row + .server-row { border-top: 1px solid var(--border); }
.server-row strong { display: block; font-weight: 500; } .server-row .dim { font-size: 12px; }
.connected { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--success); }
.connected i { width: 7px; height: 7px; border-radius: 50%; background: var(--success); }
.skill-card { position: static; margin-top: 30px; padding: 16px; border-radius: 16px; }
.skill-head { display: flex; align-items: center; gap: 12px; font-size: 14px; }
.skill-head strong { display: block; font-weight: 500; } .skill-head .dim { font-size: 12px; }
.btn.primary { background: var(--fg); color: var(--tile); font-weight: 600; }
.audits { display: flex; gap: 8px; margin-top: 16px; }
.audit { display: flex; align-items: center; gap: 6px; padding: 6px 9px; border-radius: 8px; background: var(--secondary); font-size: 12px; color: var(--fg-soft); }
.audit .ic { color: var(--success); }
.agents { display: flex; align-items: center; gap: 8px; margin-top: 14px; font-size: 12px; }
.agent { display: flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); }
.agent.on { color: var(--fg); background: var(--seg-on); }
.app-brand { flex-direction: row; gap: 6px; padding: 0 20px 0 4px; } .app-brand img { flex: none; }
.brand-name { font-size: 38px; font-weight: 600; letter-spacing: -.025em; } .app-brand .ver { font-size: 84px; margin-top: 4px; }
.visual-card { position: static; margin-top: 24px; padding: 18px; border-radius: 16px; }
.visual-title { display: flex; align-items: center; font-size: 13px; font-weight: 500; }
.figure { font-size: 20px; font-weight: 600; letter-spacing: -.02em; }
.bars { display: flex; align-items: flex-end; gap: 10px; height: 300px; margin: 24px 0 20px; padding-bottom: 1px; border-bottom: 1px solid var(--border); }
.bars span { flex: 1; border-radius: 6px 6px 2px 2px; background: linear-gradient(var(--improved), rgb(125 211 252 / 35%)); }
.slider-row { display: flex; align-items: center; gap: 12px; margin-top: 12px; font-size: 12px; }
.slider { position: relative; flex: 1; height: 4px; border-radius: 2px; background: linear-gradient(90deg, var(--fg) 58%, var(--control) 58%); }
.slider i { position: absolute; left: 58%; top: 50%; width: 14px; height: 14px; border-radius: 50%; background: var(--knob); transform: translate(-50%, -50%); }
.choices { display: flex; gap: 8px; margin-top: 14px; }
.choice { padding: 7px 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--panel); font-size: 12px; }
.csv { position: static; margin-top: 20px; padding: 6px 14px 10px; border-radius: 14px; font-size: 12px; }
.csv-tab { display: flex; align-items: center; gap: 7px; min-height: 34px; border-bottom: 1px solid var(--border); }
.csv-row { display: grid; grid-template-columns: 1fr 1.3fr .6fr; padding: 8px 2px; border-bottom: 1px solid var(--border); }
.csv-row:last-child { border-bottom: 0; }
.csv-row.head { color: var(--muted); } .csv-row.head span { display: flex; align-items: center; gap: 4px; }
.formats { display: flex; gap: 8px; margin-top: 16px; }
.update-list { position: static; margin-top: 26px; padding: 4px 14px; border-radius: 14px; }
.update-row { display: flex; align-items: center; gap: 10px; min-height: 50px; font-size: 13px; }
.update-row + .update-row { border-top: 1px solid var(--border); }
.update-row img { border-radius: 5px; }
.check { display: grid; place-items: center; width: 16px; height: 16px; border-radius: 4px; border: 1px solid var(--control); }
.check.on { background: var(--fg); color: var(--tile); border-color: var(--fg); }
`,
  render: ({ version, counts }) => `
<div class="col">${mcp}${skills}</div>
<div class="col">${brand(version)}${visuals}</div>
<div class="col">${stats(counts)}${previews}${updates}</div>`,
};

export default bento;
