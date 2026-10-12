import {
  actionSpinner,
  avatar,
  brand,
  copy,
  fileIcon,
  githubIcon,
  icon,
  stats,
  subagentSpinner,
  toggle,
  type ReleaseBento,
} from "../kit.ts";

const pullRequests = `
<section class="tile pr">
  ${copy("Pull requests, start to merge", "Checks, review comments and failing logs next to your chat. Fix hands the log to the agent.")}
  <div class="panel pr-panel">
    <div class="pr-title"><span class="ok">${icon("GitPullRequest", 16)}</span><span><span class="dim">#482</span> Pair devices over Tailscale</span><span class="grow"></span><span class="dim">${githubIcon()}</span></div>
    <div class="pills">
      <span class="pill"><span class="ok">+412</span><span class="bad">−86</span></span>
      <span class="pill"><span class="bad">${icon("X", 13)}</span>2 failing</span>
      <span class="pill">${icon("Comment", 13)}2 comments</span>
      <span class="grow"></span>
      <span class="iconbtn">${icon("RefreshCw", 14)}</span>
      <span class="btn">${icon("Tools", 14)}Fix</span>
    </div>
    <div class="checks">
      <div class="check"><span class="ok">${icon("CircleCheck", 15)}</span>lint<span class="grow"></span><span class="dim">${icon("ArrowUpRight", 14)}</span></div>
      <div class="check"><span class="ok">${icon("CircleCheck", 15)}</span>typecheck<span class="grow"></span><span class="dim">${icon("ArrowUpRight", 14)}</span></div>
      <div class="check"><span class="bad">${icon("X", 15)}</span>test<span class="badge">Required</span><span class="grow"></span><span class="dim">${icon("LayoutAlignLeft", 14)}</span><span class="dim">${icon("ArrowUpRight", 14)}</span></div>
      <div class="pre log">…
 ✓ remote/pairingTokens.test.ts (12)
 <span class="bad">✗</span> remote/pairing.test.ts &gt; expires one-time codes
   <span class="bad">AssertionError: expected 300 to be 600</span>
 Test Files  <span class="bad">1 failed</span> | 41 passed</div>
      <div class="check"><span class="ok">${icon("CircleCheck", 15)}</span>build-desktop<span class="grow"></span><span class="dim">${icon("ArrowUpRight", 14)}</span></div>
    </div>
    <div class="review"><span class="who"></span><div><div class="dim">reviewer · pairing.ts:48</div><div>Codes should expire after 10 minutes, not 5.</div></div><span class="btn">${icon("Tools", 13)}Fix</span></div>
  </div>
</section>`;

const subagentRow = (
  tone: Parameters<typeof avatar>[0],
  name: string,
  meta: string,
  step: string,
  status: string,
  usage: string,
  done = false,
) => `
  <div class="sa-row">
    ${avatar(tone)}
    <div class="sa-main">
      <div class="sa-title"><span class="sa-name">${name}</span> <span class="faint">${meta}</span></div>
      <div class="sa-line ${done ? "dim" : "shimmer"}">${done ? icon("ArrowRight02", 12, "faint") : ""}${step}</div>
    </div>
    <div class="sa-side"><div class="${done ? "faint" : "running"}">${status}</div><div class="faint">${usage}</div></div>
  </div>`;

const subagents = `
<section class="tile subagents">
  ${copy("Subagents on one card", "Live step, time and tokens for every subagent. Click one to open its chat.")}
  <div class="panel sa-panel">
    <div class="sa-head">${subagentSpinner()}<span>3 subagents · 2 running · 1 done · 1m 12s</span>${icon("ChevronDown", 14, "faint")}</div>
    <div class="tree">
      ${subagentRow("rose", "Trace pairing flow", "Sonnet 5.5 · High", "Read pairingTokens.ts", "Running · 1m 12s", "18k tokens · 12 tool calls")}
      ${subagentRow("amber", "Audit token expiry", "Haiku 5.5 · Medium", "Searched for expiresAt", "Running · 48s", "9.4k tokens · 7 tool calls")}
      ${subagentRow("emerald", "Fix flaky test", "Opus 5.5 · Extra High", "Raised code lifetime to 10 min", "Done in 42s", "6.1k tokens · 5 tool calls", true)}
    </div>
  </div>
</section>`;

const call = (glyph: Parameters<typeof icon>[0], verb: string, target: string) =>
  `<div class="call"><span class="dim">${icon(glyph, 15)}</span><span class="dim">${verb}</span>${target}</div>`;
const fileChip = (symbol: string, name: string) =>
  `<span class="chip">${fileIcon(symbol)}${name}</span>`;

const toolCalls = `
<section class="tile fill tools">
  ${copy("Tool calls you can open", "See what the agent passed in and what came back.")}
  <div class="panel tc-panel">
    <div class="tc-head">${icon("Tools", 15, "dim")}<span>Explored 3 files · ran 2 commands</span>${icon("ChevronDown", 14, "faint")}</div>
    <div class="tree">
      ${call("File02", "Read", fileChip("ts", "pairingTokens.ts"))}
      ${call("File02", "Read", fileChip("ts", "remoteAccess.ts"))}
      ${call("File02", "Read", fileChip("markdown", "REMOTE.md"))}
      <div>
        ${call("ComputerTerminal", "Ran", '<span class="mono">bun run test remote</span>')}
        <div class="pre out"> Test Files  <span class="ok">6 passed</span> (6)
      Tests  <span class="ok">42 passed</span> (42)</div>
      </div>
      ${call("ComputerTerminal", "Ran", '<span class="mono">git status --short</span>')}
    </div>
  </div>
</section>`;

const git = `
<section class="tile fill git">
  ${copy("Always the next Git step", "What comes next, why it can't run yet, and live progress.")}
  <div class="panel git-panel">
    <div class="ga"><span class="dim">${icon("GitCommitHorizontal", 16)}</span><div><div>Commit &amp; push</div><div class="xs dim">3 files changed · 1 to push</div></div><span class="grow"></span>${icon("ChevronDown", 13, "faint")}</div>
    <div class="ga live">${actionSpinner()}<div><div>Pushing to origin/feat/remote-pairing…</div><div class="xs dim">Running for 4s</div></div><span class="grow"></span>${icon("ChevronDown", 13, "faint")}</div>
    <div class="sc"><span class="iconbtn">${icon("CloudDownload", 15)}</span><span class="btn sm">${icon("ArrowDown02", 12)}2 ${icon("ArrowUp02", 12)}1 Sync</span></div>
  </div>
</section>`;

const worktrees = `
<section class="tile worktrees">
  ${copy("Worktrees that clean up", "Start from the remote or bring your changes. Merged and archived ones clean up on their own.")}
  <div class="panel wt-panel">
    <div class="wt-row"><span>Start from the latest remote branch</span>${toggle(true)}</div>
    <div class="wt-row"><span>Copy uncommitted changes</span>${toggle(false)}</div>
    <div class="sep"></div>
    <div class="wt-row"><span>Delete worktrees of merged pull requests</span>${toggle(true)}</div>
    <div class="wt-row stack"><span>Delete archived worktrees after</span>
      <div class="seg"><span>Never</span><span>14 days</span><span class="on">30 days</span><span>90 days</span></div></div>
  </div>
</section>`;

const turn = (label: string, widths: readonly number[]) =>
  `<div class="turn"><div class="turn-head">${label}${icon("ChevronRight", 13, "faint")}</div><div class="rule"></div>${widths
    .map((width) => `<i style="width:${width}%"></i>`)
    .join("")}</div>`;

const turns = `
<section class="tile fill turns">
  ${copy("Every turn, accounted for", "How long each turn worked, and whether it finished, stopped or failed.")}
  <div class="turn-list">
    ${turn("Worked for 4m 12s", [92, 78])}
    ${turn("Stopped after 38s", [64])}
    ${turn("Failed after 1m 3s", [])}
  </div>
</section>`;

const bento: ReleaseBento = {
  css: `
.grid { grid-template-columns: 540px 420px 1fr; }
.pr { height: 600px; } .subagents { height: 345px; } .brand { height: 270px; } .stats { height: 270px; } .worktrees { height: 392px; }

.pr-panel { left: 28px; right: -20px; top: 136px; bottom: -20px; padding: 16px 36px 16px 16px; }
.pr-title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; }
.pills { display: flex; align-items: center; gap: 6px; margin: 12px 0 10px; }
.checks { display: flex; flex-direction: column; gap: 2px; border-top: 1px solid var(--border); padding-top: 8px; }
.check { display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 6px; font-size: 13.5px; }
.log { margin: 2px 6px 4px; }
.review { display: flex; gap: 9px; margin: 8px 6px 0; padding: 10px 12px; border-radius: 9px; background: var(--secondary); border: 1px solid var(--border); font-size: 13px; line-height: 1.4; }
.review .who { width: 20px; height: 20px; border-radius: 50%; background: var(--skeleton); flex: none; }
.review .btn { margin-left: auto; align-self: center; }

.sa-panel { left: 20px; right: -20px; top: 136px; bottom: -20px; padding: 12px 34px 12px 14px; }
.sa-head { display: flex; align-items: center; gap: 7px; font-size: 13px; color: var(--muted); margin-bottom: 6px; }
.sa-row { display: flex; align-items: flex-start; gap: 8px; padding: 6px 2px; font-size: 13px; }
.sa-row::after { top: 17px !important; }
.sa-main { min-width: 0; flex: 1; line-height: 1.35; }
.sa-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sa-name { font-weight: 500; color: var(--fg-soft); }
.sa-title .faint { font-size: 12px; }
.sa-line { display: flex; align-items: center; gap: 4px; font-size: 12.5px; white-space: nowrap; overflow: hidden; }
.sa-side { text-align: right; font-size: 12px; line-height: 1.35; white-space: nowrap; }
.sa-side .faint { font-size: 11.5px; }

.tc-panel { left: 28px; right: -20px; top: 112px; bottom: -20px; padding: 14px 16px; }
.tc-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 13.5px; }
.call { display: flex; align-items: center; gap: 7px; height: 28px; font-size: 13.5px; }
.out { margin: 2px 24px 4px 22px; padding: 7px 12px; }

.git-panel { left: 20px; right: -20px; top: 136px; bottom: -20px; padding: 10px 30px 10px 10px; }
.ga { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; font-size: 13.5px; line-height: 1.35; }
.ga.live { background: var(--secondary); }
.sc { display: flex; align-items: center; gap: 4px; padding: 10px 10px 0; margin-top: 6px; border-top: 1px solid var(--border); }

.wt-panel { left: 28px; right: -20px; top: 140px; bottom: -20px; padding: 6px 36px 6px 16px; }
.wt-row { display: flex; align-items: center; justify-content: space-between; height: 42px; font-size: 13.5px; }
.wt-row.stack { flex-direction: column; align-items: stretch; height: auto; padding: 10px 0 6px; gap: 10px; }
.sep { height: 1px; background: var(--border); margin: 4px 0; }

.turn-list { margin-top: 18px; display: flex; flex-direction: column; gap: 12px; }
.turn-head { display: inline-flex; align-items: center; gap: 4px; font-size: 13.5px; color: var(--muted); padding-bottom: 7px; }
.rule { height: 1px; background: var(--border); margin-bottom: 8px; }
.turn i { display: block; height: 7px; border-radius: 4px; background: var(--skeleton); margin-bottom: 6px; }
`,
  render: ({ version, counts }) => `
<div class="col">${pullRequests}${toolCalls}</div>
<div class="col">${subagents}${brand(version)}${git}</div>
<div class="col">${stats(counts)}${worktrees}${turns}</div>`,
};

export default bento;
