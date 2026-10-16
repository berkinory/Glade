import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appIcon, copy, fileIcon, icon, logo, stats, type ReleaseBento } from "../kit.ts";

const artwork = (theme: "light" | "dark") =>
  `data:image/webp;base64,${readFileSync(join(import.meta.dirname, `../../../apps/web/public/artwork/nyx-${theme}.webp`)).toString("base64")}`;

const recovery = `
<section class="tile recovery">
  ${copy("Pick up after an interruption", "After an unexpected shutdown, choose the chats you want to pick back up.")}
  <div class="panel recovery-dialog">
    <div class="dialog-title">Glade stopped unexpectedly</div>
    <p class="dialog-copy">These chats were still running. Continue selected chats and let each agent check what already happened before carrying on.</p>
    <div class="recover-chat"><span class="checkbox">${icon("Tick", 12)}</span>Polish the landing page</div>
    <div class="recover-chat"><span class="checkbox">${icon("Tick", 12)}</span>Review the latest changes</div>
    <div class="dialog-actions"><span class="btn">Dismiss</span><span class="btn primary">Continue</span></div>
  </div>
</section>`;

const tools = `
<section class="tile fill tools">
  ${copy("Same tools. Same experience.", "Open edits in place, inspect images, and explore search results across providers.")}
  <div class="provider-line">${logo("openai", 22)}${logo("claude", 22)}${logo("xaigrok", 22)}${logo("opencodeai", 22)}${logo("cursor", 22)}<span class="dim">One consistent way to inspect the work.</span></div>
  <div class="panel tool-panel">
    <div class="tool-row">${icon("ChevronDown", 12, "dim")}${icon("PencilEdit02", 16, "dim")}Edited<span class="chip">${fileIcon("ts")}theme.ts</span><span class="grow"></span><span class="ok xs">+1</span><span class="bad xs">−1</span></div>
    <div class="diff"><div class="removed"><span>−</span> surface: "#ffffff",</div><div class="added"><span>+</span> surface: "#f5f4f1",</div></div>
    <div class="tool-row separated">${icon("ChevronRight", 12, "dim")}${icon("Search", 16, "dim")}Searched the web<span class="grow"></span><span class="dim xs">View results</span></div>
    <div class="tool-row separated">${icon("ChevronRight", 12, "dim")}${icon("File02", 16, "dim")}Viewed image<span class="chip">preview.png</span></div>
  </div>
</section>`;

const brand = (version: string) => `
<section class="tile brand app-brand">
  ${appIcon(185)}<div><div class="brand-name">Glade</div><div class="ver">${version}</div></div>
</section>`;

const light = `
<section class="tile light-tile">
  ${copy("A softer side of Glade", "Gentler light mode. Fresh artwork that follows your theme.")}
  <div class="light-preview">
    <img class="sidebar-art" src="${artwork("light")}" alt="">
    <div class="light-header"><span>Glade</span><span class="grow"></span>${icon("Search", 15)}${icon("SquarePen", 15)}</div>
    <div class="light-project">${icon("ChevronDown", 12)}${icon("Folder", 15)}Website<span class="grow"></span>${icon("Plus", 14)}</div>
    <div class="light-chat active">Polish the landing page</div>
    <div class="light-chat">Review the latest changes</div>
  </div>
</section>`;

const updates = `
<section class="tile fill updates">
  ${copy("Update. Get back to it.", "One step to update from the sidebar or Settings. Running chats resume after the restart.")}
  <div class="update-footer">${icon("Settings01", 16, "dim")}<span class="dim">Settings</span><span class="grow"></span><span class="update-pill">Update all</span>${icon("HelpCircle", 16, "dim")}</div>
  <div class="resume-note">${icon("RefreshCw", 15)}<span>Your work picks up after the update.</span></div>
</section>`;

const workspace = `
<section class="tile workspace">
  ${copy("Each chat, its own workspace", "Your right sidebar remembers its width, open state and selected view.")}
  <div class="panel workspace-preview">
    <div class="workspace-chat"><div class="mini-heading">${logo("openai", 16)}Codex</div><p>The preview is ready.</p><div class="text-line"></div><div class="text-line short"></div><div class="mini-composer">Ask for follow-up changes<span class="grow"></span>${icon("ArrowUp02", 13)}</div></div>
    <div class="divider"><span></span></div>
    <div class="workspace-browser"><div class="browser-tab">${icon("Globe", 13)}Browser<span class="grow"></span>${icon("X", 11)}</div><div class="address">localhost:3000</div><div class="page-preview"><span class="page-eyebrow">STUDIO</span><strong>Make room<br>for good work.</strong><div class="page-button">Explore projects ${icon("ArrowUpRight", 10)}</div></div></div>
    <div class="workspace-rail">${icon("LayoutAlignLeft", 14)}${icon("Folder", 14)}${icon("ComputerTerminal", 14)}</div>
  </div>
</section>`;

const images = `
<section class="tile fill images">
  ${copy("The image you saw stays", "Reply images and tool previews keep their original contents when source files change.")}
  <div class="saved-image"><img class="saved-thumb" src="${artwork("dark")}" alt=""><div><div class="saved-title">artwork.webp</div><div class="saved-state">${icon("CircleCheck", 14)}Preserved in chat</div><div class="dim xs">Original preview, kept intact.</div></div></div>
</section>`;

const bento: ReleaseBento = {
  css: `
.grid { grid-template-columns: 590px 420px 1fr; }
.recovery { height: 460px; } .app-brand { height: 270px; } .light-tile { height: 370px; } .stats { height: 250px; } .workspace { height: 400px; }
.recovery header h2 { font-size: 32px; letter-spacing: -0.03em; }
.recovery-dialog { position: static; margin-top: 28px; padding: 22px; border-radius: 17px; }
.dialog-title { font-size: 17px; font-weight: 600; letter-spacing: -.015em; }
.dialog-copy { margin-top: 8px; font-size: 13px; line-height: 1.5; color: var(--muted); max-width: 440px; }
.recover-chat { display: flex; align-items: center; gap: 10px; margin-top: 17px; font-size: 13px; }
.recover-chat + .recover-chat { margin-top: 12px; }
.checkbox { display: grid; place-items: center; width: 16px; height: 16px; border-radius: 4px; background: var(--fg); color: var(--tile); }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 22px; }
.btn.primary { background: var(--fg); color: var(--tile); font-weight: 600; }
.app-brand { flex-direction: row; gap: 6px; padding: 0 20px 0 4px; } .app-brand img { flex: none; }
.brand-name { font-size: 38px; font-weight: 600; letter-spacing: -.025em; } .app-brand .ver { font-size: 84px; margin-top: 4px; }
.provider-line { display: flex; align-items: center; gap: 14px; margin-top: 26px; } .provider-line > span.dim { font-size: 12px; line-height: 1.45; margin-left: 5px; max-width: 170px; }
.tool-panel { left: 28px; right: 28px; top: 205px; padding: 10px 14px; }
.tool-row { display: flex; align-items: center; gap: 8px; min-height: 43px; font-size: 13px; }
.tool-row.separated { border-top: 1px solid var(--border); }
.diff { font-family: "JetBrains Mono Variable", monospace; font-size: 12px; line-height: 30px; margin: 2px 0 12px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.diff > div { padding: 0 12px; } .diff span { margin-right: 13px; opacity: .6; }
.removed { background: rgb(248 113 113 / 9%); color: #e9a6a6; } .added { background: rgb(83 204 164 / 9%); color: #a5d7be; }
.light-preview { position: absolute; left: 28px; right: 28px; top: 146px; bottom: -16px; border: 1px solid #d6d4cf; border-radius: 14px; overflow: hidden; background: #efeeea; color: #373633; box-shadow: var(--shadow); padding: 18px 14px; }
.sidebar-art { position: absolute; inset: 0 0 auto; width: 100%; height: 155px; object-fit: cover; object-position: 50% 35%; mask-image: linear-gradient(#0008, transparent 95%); }
.light-header, .light-project, .light-chat { position: relative; }
.light-header { display: flex; gap: 14px; align-items: center; padding: 0 5px; font-size: 18px; font-weight: 600; }
.light-project { display: flex; align-items: center; gap: 7px; margin-top: 31px; padding: 0 5px 8px; font-size: 13px; }
.light-chat { border-radius: 7px; padding: 9px 12px 9px 28px; font-size: 13px; color: #67645e; } .light-chat.active { color: #292824; background: #deddd6b0; }
.update-footer { display: flex; align-items: center; gap: 10px; margin-top: 27px; padding: 13px; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; font-size: 13px; }
.update-pill { padding: 5px 11px; border-radius: 999px; background: #3b82f6; color: white; font-size: 12px; }
.resume-note { display: flex; gap: 8px; align-items: center; margin-top: 15px; font-size: 12px; color: var(--muted); }
.resume-note .ic { color: var(--improved); }
.workspace-preview { left: 28px; right: 28px; top: 140px; bottom: -18px; display: flex; overflow: hidden; }
.workspace-chat { width: 45%; padding: 17px 14px; position: relative; font-size: 12px; }
.mini-heading { display: flex; gap: 8px; align-items: center; font-size: 12px; font-weight: 500; }
.workspace-chat p { margin-top: 24px; color: var(--fg-soft); }
.text-line { height: 5px; margin-top: 12px; width: 90%; background: var(--secondary); border-radius: 3px; } .text-line.short { width: 60%; margin-top: 8px; }
.mini-composer { position: absolute; bottom: 33px; left: 10px; right: 10px; display: flex; align-items: center; gap: 8px; padding: 12px 9px; border-radius: 10px; background: var(--secondary); border: 1px solid var(--border); color: var(--muted); font-size: 9px; line-height: 1.5; }
.divider { width: 5px; border-left: 1px solid var(--border); display: grid; align-items: center; flex: none; } .divider span { width: 2px; height: 30px; border-radius: 2px; background: var(--muted); }
.workspace-browser { flex: 1; min-width: 0; padding: 11px 9px; background: #141414; }
.browser-tab { display: flex; align-items: center; gap: 6px; font-size: 11px; }
.address { margin-top: 12px; border-radius: 6px; padding: 7px; background: var(--secondary); font-size: 9px; color: var(--muted); }
.page-preview { margin-top: 8px; height: 154px; border-radius: 7px; background: #e7e5dc; color: #343b33; padding: 17px 13px; }
.page-eyebrow { display: block; font-size: 8px; letter-spacing: .14em; color: #71776d; }
.page-preview strong { display: block; font-family: Georgia, serif; font-weight: normal; font-size: 21px; line-height: 1.1; margin-top: 15px; letter-spacing: -.02em; }
.page-button { display: flex; align-items: center; gap: 6px; font-size: 8px; margin-top: 15px; }
.workspace-rail { width: 30px; display: flex; flex-direction: column; align-items: center; gap: 20px; padding-top: 13px; color: var(--muted); border-left: 1px solid var(--border); }
.saved-image { display: flex; align-items: center; gap: 16px; margin-top: 19px; padding: 10px 12px 10px 10px; border: 1px solid var(--border); background: var(--panel); border-radius: 13px; }
.saved-thumb { width: 92px; height: 92px; flex: none; border-radius: 9px; object-fit: cover; }
.saved-title { font-size: 14px; margin-bottom: 8px; } .saved-state { display: flex; align-items: center; gap: 7px; color: var(--success); font-size: 12px; margin-bottom: 7px; }
`,
  render: ({ version, counts }) => `
<div class="col">${recovery}${tools}</div>
<div class="col">${brand(version)}${light}${updates}</div>
<div class="col">${stats(counts)}${workspace}${images}</div>`,
};

export default bento;
