import {
  appIcon,
  avatar,
  copy,
  fileIcon,
  icon,
  loader,
  logo,
  stats,
  type ReleaseBento,
} from "../kit.ts";

const fileRow = (symbol: string, name: string, folder: string, trailing = "") =>
  `<div class="file">${fileIcon(symbol)}<span>${name}</span><span class="folder">${folder}</span><span class="grow"></span>${trailing}</div>`;

const rewind = `
<section class="tile rewind">
  ${copy("Rewind to any message", "Later messages go away, the message returns to the composer, and you choose whether changed files stay.")}
  <div class="bubble-wrap">
    <div class="bubble">Use 10 minute pairing codes instead</div>
    <div class="bubble-foot"><span>14:02</span>${icon("Copy", 14)}${icon("SquarePen", 14)}<span class="hot">${icon("Undo", 14)}</span></div>
    <div class="tip">Rewind to here</div>
  </div>
  <div class="panel dialog">
    <div class="d-title">Rewind to this message?</div>
    <p class="d-body">Later messages are removed and this message returns to the composer. These files changed since then: keep them as they are, or restore them.</p>
    <div class="warn"><span class="warn-ic">${icon("TriangleAlert", 15)}</span><div><div class="warn-title">Another chat worked in this folder</div><div>“Fix flaky test” also ran since then. Some of these changes may be theirs, and restoring would undo them.</div></div></div>
    <div class="files">
      ${fileRow("ts", "pairingTokens.ts", "server/remote")}
      ${fileRow("ts", "remoteAccess.ts", "server/remote")}
      ${fileRow("markdown", "REMOTE.md", "docs", '<span class="later">Edited later</span>')}
    </div>
    <div class="d-actions"><span class="btn">Cancel</span><span class="btn danger">Restore files</span><span class="btn primary">Keep files</span></div>
  </div>
</section>`;

const thinking = `
<section class="tile fill thinking">
  ${copy("Thinking gets its own row", "See how long the agent thought, and what a finished turn still waits on.")}
  <div class="panel think-panel">
    <div class="row-line">${icon("Brain", 15, "dim")}<span class="dim">Thought for 14s</span>${icon("ChevronDown", 13, "faint")}</div>
    <div class="reasoning">The codes expire in five minutes, but the review asks for ten. The constant lives in pairingTokens.ts and the test pins it, so both need to change together.</div>
    <div class="reply"><i style="width:94%"></i><i style="width:71%"></i></div>
    <div class="row-line">${avatar("rose", 16)}<span class="shimmer">Waiting for Trace pairing flow</span></div>
  </div>
</section>`;

const providers = `
<section class="tile providers">
  ${copy("Switch providers instantly", "Pick another provider and keep typing. Your next message carries the chat over, and going back resumes its own session.")}
  <div class="panel switch-panel">
    <div class="divider"><i></i><span>${logo("claude", 16)}Continued with Codex${logo("openai", 16)}</span><i></i></div>
    <div class="reply"><i style="width:88%"></i><i style="width:64%"></i></div>
    <div class="divider"><i></i><span>${logo("openai", 16)}Resumed Claude${logo("claude", 16)}</span><i></i></div>
    <div class="composer"><span class="placeholder">Ask anything</span><span class="grow"></span><span class="trigger">${logo("claude", 14)}Opus 5.5${icon("ChevronDown", 12, "faint")}</span></div>
  </div>
</section>`;

const brand = (version: string) => `
<section class="tile brand new-icon">
  ${appIcon("dark", 200)}
  <div class="brand-text"><div class="brand-name">Glade</div><div class="ver">${version}</div></div>
</section>`;

const loaders = `
<section class="tile fill loaders">
  ${copy("Loaders that say what's happening", "Actions, loading content, a working agent, subagents and voice each get their own.")}
  <div class="loader-row">
    ${(
      [
        ["action", "Action"],
        ["loading", "Loading"],
        ["working", "Working"],
        ["subagent", "Subagent"],
        ["voice", "Voice"],
      ] as const
    )
      .map(
        ([variant, label]) =>
          `<div class="loader">${loader(variant, 30)}<span>${label}</span></div>`,
      )
      .join("")}
  </div>
</section>`;

const clone = `
<section class="tile clone">
  ${copy("Clone from GitHub on any machine", "Add a GitHub project on an SSH host or a paired machine.")}
  <div class="panel clone-panel">
    <div class="d-title">Create project</div>
    <div class="machine">${icon("ServerStack", 15, "dim")}<span>studio</span><i class="online"></i><span class="grow"></span>${icon("ChevronDown", 13, "faint")}</div>
    <div class="seg"><span>Folder</span><span class="on">GitHub</span></div>
    <div class="field"><div class="label">Repository</div><div class="input"><span class="addon">${logo("github", 14)}</span>acme/api</div></div>
    <div class="field"><div class="label">Clone into</div><div class="input"><span class="addon">${icon("Folder", 14)}</span>~/dev</div></div>
    <div class="d-actions"><span class="btn">Cancel</span><span class="btn primary">Clone and add</span></div>
  </div>
</section>`;

const diffStat = (added: number, removed: number) =>
  `<span class="stat-diff"><span class="ok">+${added}</span> <span class="bad">−${removed}</span></span>`;
const edited = `
<section class="tile fill edited">
  ${copy("Edited files at a glance", "Each turn lists the files it changed, name first and then its folder.")}
  <div class="panel edit-panel">
    <div class="edit-head">${icon("PlusMinusSquare", 15, "dim")}<div><div>Edited 9 files</div><div class="xs">${diffStat(142, 37)}</div></div><span class="grow"></span><span class="undo">${icon("Undo", 13)}Undo</span><span class="review">Review</span>${icon("ChevronDown", 13, "faint")}</div>
    ${fileRow("ts", "pairingTokens.ts", "server/remote", diffStat(18, 4))}
    ${fileRow("ts", "remoteAccess.ts", "server/remote", diffStat(42, 11))}
    ${fileRow("react-ts", "PairingDialog.tsx", "web/components", diffStat(57, 9))}
    ${fileRow("markdown", "REMOTE.md", "docs", diffStat(12, 3))}
  </div>
</section>`;

const bento: ReleaseBento = {
  css: `
.grid { grid-template-columns: 520px 440px 1fr; }
.rewind { height: 620px; } .providers { height: 330px; } .new-icon { height: 300px; } .stats { height: 250px; } .clone { height: 440px; }

.btn.primary { background: var(--fg); color: var(--tile); border-color: transparent; font-weight: 600; }
.btn.danger { color: var(--failure); border-color: color-mix(in srgb, var(--failure) 40%, transparent); background: transparent; }
.d-title { font-size: 16px; font-weight: 600; }
.d-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.file { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 10px; font-size: 13px; border-top: 1px solid var(--border); }
.file:first-child { border-top: none; }
.file img { opacity: 0.7; }
.folder { color: var(--faint); font-size: 12px; }
.reply i { display: block; height: 7px; border-radius: 4px; background: var(--skeleton); margin: 0 0 6px; }
.row-line { display: flex; align-items: center; gap: 7px; height: 28px; font-size: 13.5px; }

.bubble-wrap { position: absolute; right: 28px; top: 138px; display: flex; flex-direction: column; align-items: flex-end; }
.bubble { background: var(--secondary); border: 1px solid var(--border); border-radius: 16px; padding: 10px 14px; font-size: 14px; }
.bubble-foot { display: flex; align-items: center; gap: 10px; margin-top: 6px; color: var(--muted); font-size: 12px; }
.bubble-foot .hot { color: var(--fg); background: var(--secondary); border-radius: 6px; padding: 3px; margin: -3px; }
.tip { position: absolute; right: -10px; top: 62px; background: var(--fg); color: var(--tile); font-size: 12px; font-weight: 500; padding: 4px 8px; border-radius: 6px; }
.dialog { left: 28px; right: 28px; top: 262px; padding: 18px; border-radius: 18px; }
.d-body { color: var(--muted); font-size: 13px; line-height: 1.45; margin-top: 6px; }
.warn { display: flex; gap: 9px; margin-top: 12px; padding: 10px 12px; border-radius: 10px; font-size: 12.5px; line-height: 1.4; color: var(--muted); background: rgb(252 211 77 / 8%); border: 1px solid rgb(252 211 77 / 20%); }
.warn-ic, .warn-title { color: var(--fixed); } .warn-title { font-weight: 600; }
.files { margin-top: 12px; border: 1px solid var(--border); border-radius: 10px; }
.later { color: var(--fixed); font-size: 12px; }

.think-panel { left: 28px; right: -20px; top: 112px; bottom: -20px; padding: 12px 36px 12px 16px; }
.reasoning { margin: 2px 0 12px 22px; color: var(--muted); font-size: 13px; line-height: 1.5; }
.think-panel .reply { margin: 0 0 10px; }

.switch-panel { left: 20px; right: -20px; top: 136px; bottom: -20px; padding: 6px 36px 12px 16px; }
.divider { display: flex; align-items: center; gap: 10px; padding: 12px 0; font-size: 13px; color: var(--fg-soft); }
.divider i { flex: 1; height: 1px; background: var(--border); }
.divider span { display: inline-flex; align-items: center; gap: 7px; }
.composer { display: flex; align-items: center; margin-top: 8px; padding: 10px 12px; border-radius: 14px; border: 1px solid var(--border); background: var(--inset); font-size: 13.5px; }
.placeholder { color: var(--faint); }
.trigger { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 8px; background: var(--secondary); font-size: 13px; }

.new-icon { flex-direction: row; gap: 14px; padding: 0 30px 0 10px; }
.new-icon img { flex: none; margin: -14px 0; }
.brand-text { display: flex; flex-direction: column; }
.brand-name { font-size: 40px; font-weight: 600; letter-spacing: -0.025em; }
.new-icon .ver { font-size: 88px; margin-top: 4px; }

.loader-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-top: 30px; }
.loader { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 30px 0 22px; gap: 16px; border-radius: 14px; background: var(--secondary); border: 1px solid var(--border); font-size: 13px; color: var(--muted); }
.loader svg { color: var(--fg); }

.clone-panel { left: 28px; right: -20px; top: 112px; bottom: -20px; padding: 16px 36px 16px 16px; }
.machine { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 10px; margin-top: 12px; border-radius: 9px; border: 1px solid var(--control); font-size: 13.5px; }
.online { width: 7px; height: 7px; border-radius: 50%; background: var(--success); }
.clone-panel .seg { margin-top: 10px; }
.field { margin-top: 10px; }
.field .label { font-size: 12.5px; color: var(--fg-soft); margin-bottom: 5px; font-weight: 500; }
.input { display: flex; align-items: center; height: 32px; border-radius: 9px; border: 1px solid var(--control); background: var(--inset); font-size: 13px; overflow: hidden; }
.addon { display: grid; place-items: center; width: 32px; align-self: stretch; border-right: 1px solid var(--border); margin-right: 10px; color: var(--muted); }

.edit-panel { left: 28px; right: -20px; top: 112px; bottom: -20px; padding: 0 20px 0 0; }
.edit-head { display: flex; align-items: center; gap: 9px; padding: 10px 12px; font-size: 13.5px; line-height: 1.3; }
.undo { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); font-size: 12.5px; }
.review { font-size: 12.5px; padding: 2px 9px; border-radius: 999px; border: 1px solid var(--control); }
.stat-diff { font-size: 12px; font-variant-numeric: tabular-nums; }
`,
  render: ({ version, counts }) => `
<div class="col">${rewind}${thinking}</div>
<div class="col">${providers}${brand(version)}${loaders}</div>
<div class="col">${stats(counts)}${clone}${edited}</div>`,
};

export default bento;
