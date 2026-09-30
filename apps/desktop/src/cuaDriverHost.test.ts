import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, chmod, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createConnection } from "node:net";
import { CuaDriverHost, ESCAPE_INPUT_COOLDOWN_MS } from "./cuaDriverHost";
import type { ComputerInputMonitorState } from "./escapeKillSwitchMonitor";
import {
  cuaRequest as rawCuaRequest,
  CUA_DRIVER_VERSION,
  CUA_NATIVE_REVISION,
  type CuaReply,
} from "@glade/shared/computer/cuaDriverProtocol";
const capability = "isolated-fixture-authority-00000000000000";
const cuaRequest: typeof rawCuaRequest = (path, request, options) =>
  rawCuaRequest(path, { ...(request as object), capability }, options);
const cleanups: Array<() => Promise<unknown>> = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
});
async function fixture(
  authority = capability,
  options: {
    platform?: "darwin" | "linux";
    cleanup?: "incomplete" | "wrong-pid" | "missing-admission";
    interruptCleanup?: "incomplete" | "wrong-pid" | "missing-admission" | "once-incomplete";
    inputMonitorState?: (() => ComputerInputMonitorState) | undefined;
    activateInputMonitor?: () => Promise<void>;
    onInputMonitorArmedChange?: (armed: boolean) => void;
    unpatched?: boolean;
    nativeRevision?: number | null;
    reportedRevision?: number;
    browserInputControl?: unknown;
    metadataPidOffset?: number;
    metadataDelayMs?: number;
    failAction?: boolean;
    actionResult?: Record<string, unknown>;
    cursorUnavailable?: boolean;
    logCursorState?: boolean;
    cursorEnableFailures?: number;
    cursorHideFailures?: number;
    crash?: boolean;
    sessionDeathOnce?: boolean;
    sessionDeathTransport?: boolean;

    logSessions?: boolean;
    browserRefusal?: boolean;
    browserHang?: boolean;
    browserCleanupUnconfirmed?: boolean;
    browserObservations?: boolean;
    inputDelayMs?: number;
    delayBrowserObservation?: boolean;
    delayObservation?: boolean;
    delayListWindowsMs?: number;
    hangSession?: boolean;
    dropCancel?: boolean;
    startupTimeoutMs?: number;
    deathFlag?: string;
    ownPids?: () => ReadonlySet<number>;
    cursorStyle?: () => { fill?: string; rim?: string; shadow?: string } | null | undefined;
    checkPermissions?: (options?: { readonly force: boolean }) => Promise<{
      accessibility: boolean;
      screenRecording: boolean;
      inputMonitoring?: boolean;
    }>;
    releaseHeldInput?: () => Promise<void>;
    frameTap?: {
      update: (target: unknown) => void;
      endTask: (task: unknown) => Promise<void>;
      stop: () => Promise<void>;
      dispose: () => Promise<void>;
    };
    shield?: {
      engage: (request: unknown, task?: unknown) => Promise<void>;
      release: (shieldId: string) => Promise<void>;
      releaseAll: () => Promise<number>;
      endTask: (task: unknown) => Promise<void>;
      stop: () => Promise<void>;
      dispose: () => Promise<void>;
    };
    listWindows?: Array<Record<string, unknown>>;
  } = {},
) {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: options.platform ?? "darwin" });
  cleanups.push(async () => {
    Object.defineProperty(process, "platform", platformDescriptor);
  });
  const directory = await mkdtemp(join(tmpdir(), "glade-cua-host-test-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const log = join(directory, "events.jsonl");
  const binary = join(directory, "driver");
  options = { ...options, deathFlag: join(directory, "session-died") };
  await writeFile(
    binary,
    `#!${process.execPath}
const net=require('node:net'),fs=require('node:fs');
const log=${JSON.stringify(log)}, options=${JSON.stringify(options)};
const write=event=>fs.appendFileSync(log,JSON.stringify({event,pid:process.pid,time:Date.now()})+'\\n');
write('start');
if(!options.unpatched){
  if(!process.argv.includes('--compact-cursor')) throw new Error('Missing compact cursor profile');
  if(process.argv[process.argv.indexOf('--idle-hide-ms')+1]!=='60000') throw new Error('Missing cursor idle deadline');
}
if(options.unpatched&&(process.argv.includes('--compact-cursor')||process.argv.includes('--idle-hide-ms'))) throw new Error('Upstream driver cannot parse Glade cursor flags');
const socket=process.argv[process.argv.indexOf('--socket')+1];
let action, timer, inputEpoch=0, interruptions=0, browserCleanupPending=false, cursorEnables=0, cursorHides=0;
net.createServer(s=>{
  const reply=result=>s.end(JSON.stringify({ok:true,result})+'\\n');
  s.once('data',b=>{
    const r=JSON.parse(b.toString());
    if(options.logSessions&&r.method==='call'&&r.args&&typeof r.args.session==='string') write('session:'+r.args.session+':'+r.name);
    if(r.method==='metadata') setTimeout(()=>reply({driver_version:${JSON.stringify(CUA_DRIVER_VERSION)},glade_native_revision:options.reportedRevision??(options.unpatched?undefined:${CUA_NATIVE_REVISION}),glade_browser_input_control:options.browserInputControl,embedded:true,pid:process.pid+(options.metadataPidOffset??0)}),options.metadataDelayMs??0);
    else if(r.method==='interrupt_input') {
      write('interrupt');
      if(r.args.expected_pid!==process.pid) throw new Error('Wrong interrupt generation');
      inputEpoch++; interruptions++;
      clearTimeout(timer);
      if(action) { write('release'); action.end(JSON.stringify({ok:false,error:'interrupted'})+'\\n'); action=undefined; }
      const incomplete=browserCleanupPending||options.interruptCleanup==='incomplete'||(options.interruptCleanup==='once-incomplete'&&interruptions===1);
      setTimeout(()=>{
        write('interrupt-ack');
        reply({pid:process.pid+(options.interruptCleanup==='wrong-pid'?1:0),input_interrupted:true,input_admission_open:options.interruptCleanup==='missing-admission'?undefined:!incomplete,cleanup_complete:!incomplete,pending_input:incomplete?1:0,input_epoch:inputEpoch});
      },30);
    }
    else if(r.method==='cancel_input') {
      write('cancel');
      if(options.dropCancel) { s.destroy(); return; }
      if(r.args.expected_pid!==process.pid) throw new Error('Wrong generation');
      clearTimeout(timer);
      if(action) { write('release'); action.end(JSON.stringify({ok:false,error:'cancelled'})+'\\n'); action=undefined; }
      setTimeout(()=>{
        write('cleanup-ack');
        reply({pid:process.pid+(options.cleanup==='wrong-pid'?1:0),input_admission_closed:options.cleanup==='missing-admission'?undefined:true,cleanup_complete:!browserCleanupPending&&options.cleanup!=='incomplete',pending_input:browserCleanupPending||options.cleanup==='incomplete'?1:0});
      },30);
    }
    else if(options.sessionDeathOnce && r.method==='call' && r.args && r.args.session && r.name!=='start_session' && r.name!=='set_agent_cursor_motion' && r.name!=='set_agent_cursor_style' && r.name!=='set_agent_cursor_enabled' && r.name!=='get_agent_cursor_state' && !fs.existsSync(options.deathFlag)) { fs.writeFileSync(options.deathFlag, '1'); reply({isError:true, content:[{type:'text', text:"session '"+r.args.session+"' has ended; tool call '"+r.name+"' was rejected. Call start_session with this id to revive it before issuing further actions, or use a new session id."}], structuredContent:{effect:'not-dispatched'}}); }
    else if(options.sessionDeathTransport && r.method==='call' && r.args && r.args.session && r.name!=='start_session' && r.name!=='set_agent_cursor_motion' && r.name!=='set_agent_cursor_style' && r.name!=='set_agent_cursor_enabled' && r.name!=='get_agent_cursor_state' && !fs.existsSync(options.deathFlag)) { fs.writeFileSync(options.deathFlag, '1'); s.end(JSON.stringify({ok:false,error:"session '"+r.args.session+"' has ended; tool call '"+r.name+"' was rejected. Call start_session with this id to revive it before issuing further actions, or use a new session id.",effect:'not-dispatched'})+'\\n'); }
    else if(r.name==='type_text') {
      if(!options.unpatched&&r.expected_input_epoch!==inputEpoch) { reply({isError:true,structuredContent:{effect:'refused',code:'input_admission_closed'}}); return; }
      write('dispatch'); action=s;
      if(options.crash) { write('crash'); process.exit(1); }
      else if(options.failAction) s.destroy();
      else timer=setTimeout(()=>{write('effect');reply({});action=undefined},options.inputDelayMs??10000);
    }
    else if(options.hangSession && r.name==='start_session' && !fs.existsSync(options.deathFlag)) { fs.writeFileSync(options.deathFlag,'1'); write('session-hang'); }
    else if(r.name==='set_agent_cursor_motion') { write('motion-'+r.args.glide_duration_ms+'-'+r.args.dwell_after_click_ms); reply({}); }
    else if(r.name==='set_agent_cursor_style') { write('style:'+JSON.stringify(r.args)); reply({}); }
    else if(r.name==='set_agent_cursor_enabled') {
      if(options.logCursorState) write('cursor-enabled:'+r.args.enabled+':'+r.args.session);
      const failed=r.args.enabled?cursorEnables++<(options.cursorEnableFailures??0):cursorHides++<(options.cursorHideFailures??0);
      reply(failed?{isError:true}:{});
    }
    else if(r.name==='get_agent_cursor_state') {
      if(options.logCursorState) write('cursor-state:'+r.args.session);
      reply(options.cursorUnavailable?{isError:true,content:[{type:'text',text:'private overlay error'}]}:{structuredContent:{session:r.args.session,enabled:true,position:{x:10,y:20},motion:{idle_hide_ms:60000},overlay_ready:true,render_visible:true,overlay_scope:'main_display'}});
    }
    else if(options.browserInputControl===1&&['clipboard_read','clipboard_write','kill_app','move_cursor'].includes(r.name)) {
      if(r.expected_input_epoch!==inputEpoch) { reply({isError:true,structuredContent:{effect:'refused',code:'input_admission_closed'}}); return; }
      write('permitted-native:'+r.name); reply({});
    }
    else if(r.name==='press_key') { if(!options.unpatched&&r.expected_input_epoch!==inputEpoch) { reply({isError:true,structuredContent:{effect:'refused',code:'input_admission_closed'}}); return; } write('key'); write('observation-budget-'+process.env.GLADE_CUA_FOREGROUND_OBSERVATION_MS); reply(options.actionResult??{}); }
    else if(r.name==='get_window_state' && !r.args?.empty) { write('observe'); setTimeout(()=>reply({structuredContent:{elements:r.args?.fixture_usable?[{role:"AXWindow"}]:[],window_is_on_screen:r.args?.fixture_usable===true,window_on_current_space:r.args?.fixture_usable===true,degraded:r.args?.fixture_degraded,screenshot_frame_valid:r.args?.fixture_stale!==true,pid:r.args?.pid,window_id:r.args?.fixture_wrong_window?99999:r.args?.window_id}}),options.delayObservation?60:0); }
    else if(r.name==='get_desktop_state') reply({content:[{type:'image',data:'fixture-image'}]});
    else if(r.name==='list_windows') { write('list-windows'); setTimeout(()=>{reply({structuredContent:{windows:options.listWindows||[]}});if(options.delayListWindowsMs) write('list-windows-replied');},options.delayListWindowsMs??0); }
    // Browser family observability: the persistent control connection opens
    // with session_begin; lifecycle calls attributed to a transport session
    // are the browser path (the desktop start_session carries no session_id).
    // session_begin replies without s.end: the real driver holds the control
    // connection open — its lifetime is what the transport session rides on.
    else if(r.method==='session_begin') { write('session-begin:'+r.session_id); s.write(JSON.stringify({ok:true,result:{session_begin:true}})+'\\n'); }
    else if((r.name==='start_session'||r.name==='end_session')&&r.session_id) { write(r.name+':'+r.args.session+':'+r.session_id); reply({}); }
    // Lifecycle calls without a transport envelope: the generation's own
    // openSession start_session and a task-label revival. Distinct event name
    // keeps them out of the browser lifecycle assertions above.
    else if(options.logSessions&&(r.name==='start_session'||r.name==='end_session')) { write('open_session:'+r.name+':'+r.args.session); reply({}); }
    else if(r.name==='start_session'||r.name==='end_session') { reply({}); }
    else if(r.name&&(r.name.indexOf('browser_')===0||r.name==='get_browser_state')) {
      write('browser:'+r.name+':'+(r.args&&r.args.session)+':'+(r.session_id||'-'));
      if(r.name.indexOf('browser_')===0&&(!options.unpatched||options.browserInputControl===1)&&r.expected_input_epoch!==inputEpoch) { reply({isError:true,structuredContent:{effect:'refused',code:'input_admission_closed'}}); return; }
      if(options.browserObservations&&r.name==='get_browser_state') {
        if(r.args?.target_id) {
          write('browser-observe');
          const data={status:'ok',mode:r.args.fixture_bind_only?'bind':'snapshot',target_id:r.args.fixture_wrong_target?'wrong-target':r.args.target_id,tab_id:r.args.tab_id,refs:[]};
          if(r.args.snapshot_format==='semantic_v2') data.snapshot={id:'p1'}; else data.snapshot_id='p1';
          setTimeout(()=>reply({structuredContent:data}),options.delayBrowserObservation?60:0);
        } else reply({structuredContent:{status:'ok',mode:'bind',binding_quality:'exact',mutation_allowed:true,target_id:r.args.fixture_target_id||'target-'+r.args.pid+'-'+r.args.window_id,tabs:[]}});
      }
      else if(options.browserHang&&r.name==='browser_type') { write('browser-dispatch'); action=s; timer=setTimeout(()=>{write('browser-effect'); reply({}); action=undefined},options.inputDelayMs??10000); }
      else if(options.browserCleanupUnconfirmed&&r.name==='browser_type') { browserCleanupPending=true; reply({isError:true,structuredContent:{input_cleanup_unconfirmed:true,effect:'unverifiable'}}); }
      else reply(options.browserRefusal?{structuredContent:{status:'refused',refusal:{code:'browser_requires_setup'}},content:[{type:'text',text:'refused (browser_requires_setup)'}]}:{});
    }
    else reply({});
  });
  s.on('error',()=>{});
}).listen(socket);
let retiring=false;
function retire(){if(retiring)return;retiring=true;write('retiring');setTimeout(()=>{write('exit');process.exit(0)},150)}
process.on('SIGTERM',retire);
process.stdin.resume(); process.stdin.on('end',retire);
`,
  );
  await chmod(binary, 0o755);
  const host = new CuaDriverHost({
    binaryPath: binary,
    bundleId: "fixture",
    capability: authority,
    setup: async () => {},
    ...(options.checkPermissions ? { checkPermissions: options.checkPermissions } : {}),
    ...(options.releaseHeldInput ? { releaseHeldInput: options.releaseHeldInput } : {}),
    ...(options.inputMonitorState ? { inputMonitorState: options.inputMonitorState } : {}),
    ...(options.activateInputMonitor ? { activateInputMonitor: options.activateInputMonitor } : {}),
    ...(options.onInputMonitorArmedChange
      ? { onInputMonitorArmedChange: options.onInputMonitorArmedChange }
      : {}),
    ...(options.frameTap ? { frameTap: options.frameTap } : {}),
    ...(options.shield ? { shield: options.shield } : {}),
    ...(options.startupTimeoutMs ? { startupTimeoutMs: options.startupTimeoutMs } : {}),
    ...(options.nativeRevision !== undefined ? { nativeRevision: options.nativeRevision } : {}),
    ...(options.ownPids ? { ownPids: options.ownPids } : {}),
    ...(options.cursorStyle ? { cursorStyle: options.cursorStyle } : {}),
  });
  const events = async () =>
    (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((row) => JSON.parse(row));
  cleanups.push(async () => {
    try {
      await host.dispose();
    } catch (error) {
      if (!options.cleanup && !options.crash && !options.browserCleanupUnconfirmed) throw error;
    }

    for (const event of await events().catch(() => [])) {
      if (event.event === "start") {
        try {
          process.kill(event.pid, "SIGKILL");
        } catch {}
      }
    }
  });
  const endpoint = await host.listen();
  return { host, endpoint, events };
}

async function foregroundCollision(
  f: Awaited<ReturnType<typeof fixture>>,
  task: { threadId: string; turnId: string },
  target: { pid: number; window_id: number },
): Promise<void> {
  const typing = cuaRequest(
    f.endpoint,
    {
      method: "call",
      name: "type_text",
      args: { ...target, delivery_mode: "foreground", text: "fixture" },
      task,
    },
    { mutation: true },
  );
  await waitForEvent(f, "dispatch");
  expect(
    f.host.physicalInput({
      type: "physical-input",
      kind: "pointer",
      pid: target.pid,
      windowId: target.window_id,
    }),
  ).toBe(true);
  await expect(typing).resolves.toMatchObject({ ok: false, effect: "dispatched-unknown" });
  await waitForEvent(f, "interrupt-ack");
}

async function waitForEvent(
  f: Awaited<ReturnType<typeof fixture>>,
  event: string,
): Promise<Array<{ event: string; pid: number; time: number }>> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const events = await f
      .events()
      .catch(() => [] as Array<{ event: string; pid: number; time: number }>);
    if (events.some((row) => row.event === event)) return events;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const events = await f.events().catch(() => []);
  throw new Error(
    `Timed out waiting for driver event ${event}; saw ${events.map((row) => row.event).join(", ")}`,
  );
}

describe("Cua macOS host retirement", () => {
  it("checks permissions through the fresh shared helper without starting Cua or requesting grants", async () => {
    let permissions = { accessibility: false, screenRecording: false };
    const f = await fixture(capability, {
      checkPermissions: async () => permissions,
    });
    const check = () =>
      cuaRequest(f.endpoint, {
        method: "call",
        name: "check_permissions",
        args: { prompt: true },
      });
    await expect(check()).resolves.toMatchObject({
      result: {
        structuredContent: {
          accessibility: false,
          screen_recording: false,
          source: {
            attribution: "host",
            host_bundle_id: "fixture",
            probe: "computer-helper-permission-helper",
          },
        },
      },
    });
    permissions = { accessibility: true, screenRecording: true };
    await expect(check()).resolves.toMatchObject({
      result: {
        structuredContent: { accessibility: true, screen_recording: true },
      },
    });
    await expect(f.events()).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("requires an uncached confirming read before accepting a changed permission snapshot", async () => {
    let granted = false;
    const checks: boolean[] = [];
    const f = await fixture(capability, {
      checkPermissions: async (options) => {
        checks.push(options?.force === true);
        return { accessibility: granted, screenRecording: granted };
      },
    });
    await cuaRequest(f.endpoint, { method: "call", name: "check_permissions" });
    granted = true;
    await cuaRequest(f.endpoint, { method: "call", name: "check_permissions" });
    expect(checks).toEqual([false, false, true]);
  });

  it("does not bypass failed cleanup when refreshed permissions change", async () => {
    let granted = true;
    const f = await fixture(capability, {
      cleanup: "incomplete",
      checkPermissions: async () => ({
        accessibility: granted,
        screenRecording: granted,
      }),
    });
    await cuaRequest(f.endpoint, { method: "call", name: "check_permissions" });
    await cuaRequest(f.endpoint, { method: "call", name: "get_screen_size" });

    await cuaRequest(f.endpoint, {
      method: "call",
      name: "press_key",
      args: { key: "enter" },
    });
    granted = false;
    await expect(
      cuaRequest(f.endpoint, { method: "call", name: "check_permissions" }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      cuaRequest(f.endpoint, {
        method: "call",
        name: "get_window_state",
        modelObservation: true,
      }),
    ).resolves.toMatchObject({ ok: false });
    expect((await f.events()).filter((event) => event.event === "start")).toHaveLength(1);
  });
  it("does not start while locked and requires fresh state after all desktop pauses end", async () => {
    const f = await fixture();
    await f.host.pauseDesktop("screen-lock");
    await f.host.pauseDesktop("system-sleep");
    f.host.resume();
    const press = () => cuaRequest(f.endpoint, { method: "call", name: "press_key" });
    await expect(press()).resolves.toMatchObject({
      result: {
        isError: true,
        structuredContent: { code: "computer_input_paused", effect: "refused" },
      },
    });
    await expect(f.events()).rejects.toMatchObject({ code: "ENOENT" });
    f.host.resumeDesktop("screen-lock");
    await expect(press()).resolves.toMatchObject({ result: { isError: true } });
    f.host.resumeDesktop("system-sleep");
    await cuaRequest(f.endpoint, { method: "call", name: "check_permissions" });
    await expect(press()).resolves.toMatchObject({ result: { isError: true } });
    await cuaRequest(f.endpoint, {
      method: "call",
      name: "get_window_state",
      modelObservation: true,
      args: { pid: 1, window_id: 2 },
    });
    await expect(press()).resolves.toMatchObject({ ok: true });
    expect((await f.events()).filter((event) => event.event === "key")).toHaveLength(1);
  });

  it("retires a driver-ended session and retries once with a fresh one", async () => {
    // The driver confirms nothing dispatched, so one retire-plus-retry is replay-safe.
    const f = await fixture(capability, { sessionDeathOnce: true });
    const reply = await cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "press_key",
      args: { key: "enter" },
    });
    expect(reply.ok).toBe(true);
    expect(reply.result?.isError).not.toBe(true);
    const events = await f.events();

    expect(events.filter((event) => event.event === "start")).toHaveLength(2);
    expect(events.filter((event) => event.event === "key")).toHaveLength(1);
  });

  it("locking cancels active native input and rejects waiting input before dispatch", async () => {
    const f = await fixture();
    const active = cuaRequest(f.endpoint, {
      method: "call",
      name: "type_text",
      args: { text: "fixture" },
    });
    for (let attempt = 0; attempt < 200; attempt++) {
      if ((await f.events().catch(() => [])).some((event) => event.event === "dispatch")) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect((await f.events()).some((event) => event.event === "dispatch")).toBe(true);
    const queued = cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "press_key",
    });
    await f.host.pauseDesktop("screen-lock");
    expect(await active).toMatchObject({ ok: false });
    const queuedReply = await queued;
    expect(queuedReply.ok === false || queuedReply.result?.isError === true).toBe(true);
    const events = await f.events();
    expect(events.some((event) => event.event === "cleanup-ack")).toBe(true);
    expect(events.some((event) => event.event === "effect" || event.event === "key")).toBe(false);
  });

  it("unlock does not bypass an unacknowledged cleanup barrier", async () => {
    const f = await fixture(capability, { cleanup: "incomplete" });
    await cuaRequest(f.endpoint, { method: "call", name: "check_permissions" });
    await cuaRequest(f.endpoint, {
      method: "call",
      name: "press_key",
      args: { key: "enter" },
    });
    await expect(f.host.pauseDesktop("screen-lock")).rejects.toThrow(
      "did not confirm native input cleanup",
    );
    f.host.resumeDesktop("screen-lock");
    await expect(
      cuaRequest(f.endpoint, { method: "call", name: "get_window_state" }),
    ).resolves.toMatchObject({ ok: false });
    expect((await f.events()).filter((event) => event.event === "start")).toHaveLength(1);
  });

  it("preserves multibyte UTF-8 across incoming socket chunks", async () => {
    const authority = capability + "-è🧪";
    const f = await fixture(authority);
    const request = Buffer.from(JSON.stringify({ method: "probe", capability: authority }) + "\n");
    const split = request.indexOf(Buffer.from("🧪")) + 1;
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = createConnection(f.endpoint);
      let result = "";
      socket.setTimeout(2_000, () => socket.destroy(new Error("Fixture socket timed out.")));
      socket.once("error", reject);
      socket.on("data", (chunk) => {
        result += chunk.toString("utf8");
      });
      socket.once("end", () => resolve(result));
      socket.once("connect", () => {
        socket.write(request.subarray(0, split));
        setTimeout(() => socket.write(request.subarray(split)), 30);
      });
    });
    expect(JSON.parse(reply)).toMatchObject({ ok: true });
    await expect(f.events()).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("requires GUI authority even when a provider discovers the socket", async () => {
    const f = await fixture();
    await expect(
      rawCuaRequest(f.endpoint, { method: "call", name: "check_permissions" }),
    ).resolves.toMatchObject({ ok: false });
    await expect(f.events()).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("releases uncertain input before termination and waits for exit before replacement", async () => {
    const f = await fixture();
    await cuaRequest(f.endpoint, {
      method: "call",
      name: "check_permissions",
      args: {},
    });
    await expect(
      cuaRequest(
        f.endpoint,
        { method: "call", name: "type_text", args: { text: "fixture" } },
        { timeoutMs: 120, mutation: true },
      ),
    ).rejects.toMatchObject({ effect: "dispatched-unknown" });
    await f.host.stop();
    await expect(
      cuaRequest(f.endpoint, {
        method: "call",
        name: "check_permissions",
        args: {},
      }),
    ).resolves.toMatchObject({ ok: true });
    const events = await f.events();
    const starts = events.filter((e) => e.event === "start");
    expect(starts).toHaveLength(2);
    const exit = events.find((e) => e.event === "exit" && e.pid === starts[0].pid);
    expect(exit).toBeDefined();
    expect(starts[1].time).toBeGreaterThanOrEqual(exit.time);
    expect(events.some((e) => e.event === "effect")).toBe(false);
    expect(events.filter((e) => e.event === "dispatch")).toHaveLength(1);
    const first = events.filter((e) => e.pid === starts[0].pid).map((e) => e.event);
    expect(first).toEqual([
      "start",
      "motion-100-0",
      "dispatch",
      "cancel",
      "release",
      "cleanup-ack",
      "retiring",
      "exit",
    ]);
  });
  it("keeps admission closed for the host's lifetime when held-input release fails", async () => {
    const f = await fixture(capability, {
      crash: true,
      releaseHeldInput: () => Promise.reject(new Error("helper gone")),
    });
    await expect(
      cuaRequest(
        f.endpoint,
        { method: "call", name: "type_text", args: { text: "fixture" } },
        { timeoutMs: 1_000, mutation: true },
      ),
    ).resolves.toMatchObject({ ok: false });

    await expect(
      cuaRequest(f.endpoint, { method: "call", name: "check_permissions" }),
    ).resolves.toMatchObject({ ok: false, effect: "not-dispatched" });
    expect((await f.events()).filter((event) => event.event === "start")).toHaveLength(1);
    await expect(f.host.stop()).rejects.toThrow("admission is closed");
  });
  it("blocks replacement when a driver crashes during input", async () => {
    const f = await fixture(capability, { crash: true });
    await expect(
      cuaRequest(f.endpoint, {
        method: "call",
        name: "type_text",
        args: { text: "fixture" },
      }),
    ).resolves.toMatchObject({ ok: false, effect: "dispatched-unknown" });
    await expect(
      cuaRequest(f.endpoint, { method: "call", name: "check_permissions" }),
    ).resolves.toMatchObject({ ok: false, effect: "not-dispatched" });
    expect((await f.events()).filter((e) => e.event === "start")).toHaveLength(1);
  });
  it("rejects an upstream binary before native input is admitted", async () => {
    const f = await fixture(capability, { unpatched: true });
    // The default host still expects the patched build, so it passes the Glade cursor flags — a
    // faithful upstream binary exits on arguments it cannot parse, which refuses the call before any
    // input is dispatched.
    await expect(
      cuaRequest(f.endpoint, {
        method: "call",
        name: "type_text",
        args: { text: "fixture" },
      }),
    ).resolves.toMatchObject({ ok: false, effect: "not-dispatched" });
    expect((await f.events()).map((e) => e.event)).toEqual(["start"]);
  });
  it("refuses unlisted driver operations before starting a daemon", async () => {
    const f = await fixture();
    const response = await cuaRequest<{ ok: boolean }>(f.endpoint, {
      method: "call",
      name: "browser_navigate",
      args: { url: "https://example.com" },
    });
    expect(response.ok).toBe(false);
    await expect(f.events()).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("task-owned user stop", () => {
  const task = { threadId: "thread", turnId: "turn" };
  it("user Stop refuses subsequent calls from the same turn", async () => {
    const f = await fixture();
    await f.host.stopTaskByUser(task);
    const blocked = await cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "press_key",
      task,
      args: { key: "enter", pid: 42, window_id: 10 },
    });
    expect(blocked).toMatchObject({ ok: false, effect: "not-dispatched" });
    expect(blocked.error).toContain("user stopped");
    await expect(f.events()).rejects.toMatchObject({ code: "ENOENT" });
    const next = await cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "get_window_state",
      task: { ...task, turnId: "next" },
      modelObservation: true,
      args: { pid: 42, window_id: 10 },
    });
    expect(next.ok).toBe(true);
  });

  it("drains matching native input and reports that queued siblings share the generation fence", async () => {
    const f = await fixture();
    const active = cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "type_text",
      task,
      args: { text: "fixture" },
    });
    await waitForEvent(f, "dispatch");
    const sibling = { threadId: "other-thread", turnId: "turn" };
    const queued = cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "press_key",
      task: sibling,
      args: { key: "enter" },
    });
    await expect(cuaRequest(f.endpoint, { method: "stop", task })).resolves.toMatchObject({
      ok: true,
      result: { stop_scope: "generation" },
    });
    await expect(active).resolves.toMatchObject({ ok: false, effect: "dispatched-unknown" });
    await expect(queued).resolves.toMatchObject({ ok: false, effect: "not-dispatched" });
    await expect(
      cuaRequest(f.endpoint, {
        method: "call",
        name: "press_key",
        task: sibling,
        args: { key: "enter" },
      }),
    ).resolves.toMatchObject({ ok: true });
    const events = (await f.events()).map((row) => row.event);
    expect(events.indexOf("interrupt-ack")).toBeLessThan(events.indexOf("key"));
    expect(events.filter((event) => event === "start")).toHaveLength(1);
    expect(events).not.toContain("effect");
    expect(events).not.toContain("cancel");
    expect(events).not.toContain("retiring");
  });

  it("revokes a task during native startup without retiring the sibling's shared generation", async () => {
    const f = await fixture(capability, { metadataDelayMs: 100 });
    const starting = cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "press_key",
      task,
      args: { key: "enter" },
    });
    await waitForEvent(f, "start");
    await expect(cuaRequest(f.endpoint, { method: "stop", task })).resolves.toMatchObject({
      ok: true,
      result: { stop_scope: "task" },
    });
    await expect(starting).resolves.toMatchObject({ ok: false, effect: "not-dispatched" });
    await expect(
      cuaRequest(f.endpoint, { method: "call", name: "press_key", args: { key: "enter" } }),
    ).resolves.toMatchObject({ ok: true });
    const events = (await f.events()).map((row) => row.event);
    expect(events.filter((event) => event === "key")).toHaveLength(1);
    expect(events.filter((event) => event === "start")).toHaveLength(1);
    expect(events).not.toContain("interrupt");
    expect(events).not.toContain("retiring");
  });
});

describe("browser surface", () => {
  const task = { threadId: "thread", turnId: "turn" };
  it("attributes browser calls to a per-thread lifecycle session under the control transport", async () => {
    const f = await fixture();
    const reply = await cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "browser_navigate",
      task,
      args: { url: "https://example.com" },
    });
    expect(reply.ok).toBe(true);
    const events = (await f.events()).map((row) => row.event);

    expect(events.some((event) => event.startsWith("session-begin:glade-transport-"))).toBe(true);
    expect(
      events.some((event) =>
        event.startsWith("browser:browser_navigate:glade-browser-thread:glade-transport-"),
      ),
    ).toBe(true);

    const forged = await cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "browser_click",
      task,
      args: { target_id: "t", tab_id: "tab", ref: "p1:0", session: "forged" },
    });
    expect(forged.ok).toBe(true);
    expect(
      (await f.events()).some((row) =>
        String(row.event).startsWith("browser:browser_click:forged"),
      ),
    ).toBe(false);
    expect(
      (await f.events()).some((row) =>
        String(row.event).startsWith("browser:browser_click:glade-browser-thread:glade-transport-"),
      ),
    ).toBe(true);
  });
  it("refuses browser calls without task attribution before starting a daemon", async () => {
    const f = await fixture();
    const reply = await cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "browser_navigate",
      args: { url: "https://example.com" },
    });
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain("task attribution");
    await expect(f.events()).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("refuses a browser bind that names one of this app's own pids", async () => {
    const f = await fixture(capability, { ownPids: () => new Set([424242]) });
    const reply = await cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "get_browser_state",
      task,
      args: { pid: 424242, window_id: 20 },
    });
    expect(reply.ok).toBe(true);
    expect(reply.result?.isError).toBe(true);
    expect(reply.result?.structuredContent).toMatchObject({
      effect: "refused",
      code: "browser_self_target",
    });

    await expect(f.events()).rejects.toMatchObject({ code: "ENOENT" });

    const other = await cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "get_browser_state",
      task,
      args: { pid: 777, window_id: 20 },
    });
    expect(other.ok).toBe(true);
    expect(
      (await f.events()).some((row) => String(row.event).startsWith("browser:get_browser_state:")),
    ).toBe(true);
  });
});

describe("physical Escape interrupt", () => {
  const pressKey = (endpoint: string) =>
    cuaRequest<CuaReply>(endpoint, {
      method: "call",
      name: "press_key",
      args: { key: "enter" },
    });

  it("drains native input, keeps the generation, and requires fresh observation after Escape", async () => {
    let releaseCalls = 0;
    const f = await fixture(capability, {
      releaseHeldInput: async () => {
        releaseCalls += 1;
      },
    });

    await expect(pressKey(f.endpoint)).resolves.toMatchObject({ ok: true });

    // The fake driver holds a type_text reply for 10s — the wedged-provider shape the interrupt exists
    // for. The press must not wait on it.
    const hung = cuaRequest(
      f.endpoint,
      { method: "call", name: "type_text", args: { text: "fixture" } },
      { timeoutMs: 5_000, mutation: true },
    );
    await waitForEvent(f, "dispatch");
    expect(f.host.emergencyStopInput()).toBe(true);

    await expect(hung).resolves.toMatchObject({ ok: false });
    await waitForEvent(f, "interrupt-ack");
    expect(releaseCalls).toBe(0);
    const mid = await f.events();
    expect(mid.some((event) => event.event === "interrupt")).toBe(true);
    expect(mid.filter((event) => event.event === "release")).toHaveLength(1);
    expect(mid.some((event) => event.event === "effect")).toBe(false);
    expect(mid.some((event) => event.event === "cancel")).toBe(false);
    expect(mid.some((event) => event.event === "retiring")).toBe(false);
    expect(mid.filter((event) => event.event === "start")).toHaveLength(1);

    await expect(pressKey(f.endpoint)).resolves.toMatchObject({
      ok: true,
      result: {
        isError: true,
        structuredContent: { effect: "refused", code: "computer_input_paused" },
      },
    });
    await expect(
      cuaRequest(f.endpoint, { method: "call", name: "list_windows" }),
    ).resolves.toMatchObject({ ok: true });

    await new Promise((resolve) => setTimeout(resolve, ESCAPE_INPUT_COOLDOWN_MS + 50));
    await expect(pressKey(f.endpoint)).resolves.toMatchObject({
      result: { structuredContent: { code: "computer_input_paused" } },
      desktopInterruptions: 0,
    });
    await cuaRequest(f.endpoint, { method: "call", name: "get_window_state" });
    await expect(
      cuaRequest(f.endpoint, { method: "call", name: "check_input_ready" }),
    ).resolves.toMatchObject({ result: { isError: true } });
    await cuaRequest(f.endpoint, {
      method: "call",
      name: "get_window_state",
      modelObservation: true,
    });
    await expect(pressKey(f.endpoint)).resolves.toMatchObject({ ok: true, result: {} });
    const after = await f.events();
    expect(after.filter((event) => event.event === "start")).toHaveLength(1);
    expect(after.filter((event) => event.event === "key")).toHaveLength(2);
    expect(after.some((event) => event.event === "retiring")).toBe(false);
  });

  it("keeps admission closed after a driver crash until the held-input release is confirmed", async () => {
    const release = deferred<void>();
    const f = await fixture(capability, {
      crash: true,
      releaseHeldInput: async () => {
        await release.promise;
      },
    });

    const crashing = cuaRequest(
      f.endpoint,
      { method: "call", name: "type_text", args: { text: "fixture" } },
      { timeoutMs: 5_000, mutation: true },
    );
    await waitForEvent(f, "crash");
    expect(f.host.emergencyStopInput()).toBe(true);

    release.resolve();
    await expect(crashing).resolves.toMatchObject({ ok: false });

    await f.host.stop();

    await new Promise((resolve) => setTimeout(resolve, ESCAPE_INPUT_COOLDOWN_MS + 50));
    await cuaRequest(f.endpoint, {
      method: "call",
      name: "get_window_state",
      modelObservation: true,
    });
    await expect(pressKey(f.endpoint)).resolves.toMatchObject({ ok: true, result: {} });
  });

  it("keeps input closed after an incomplete native interrupt and rechecks the drain before dispatch", async () => {
    const releaseHeldInput = vi.fn(async () => {});
    const f = await fixture(capability, { interruptCleanup: "once-incomplete", releaseHeldInput });
    await pressKey(f.endpoint);
    await expect(cuaRequest(f.endpoint, { method: "stop" })).resolves.toMatchObject({ ok: false });
    expect(releaseHeldInput).toHaveBeenCalledTimes(1);
    expect((await f.events()).filter((event) => event.event === "key")).toHaveLength(1);
    await expect(pressKey(f.endpoint)).resolves.toMatchObject({ ok: true, result: {} });
    const events = (await f.events()).map((event) => event.event);
    expect(events.filter((event) => event === "interrupt")).toHaveLength(2);
    expect(events.filter((event) => event === "key")).toHaveLength(2);
    expect(events.lastIndexOf("interrupt-ack")).toBeLessThan(events.lastIndexOf("key"));
    expect(events.filter((event) => event === "start")).toHaveLength(1);
  });

  it.each(["wrong-pid", "missing-admission", "incomplete"] as const)(
    "never resumes input on a %s interruption acknowledgement",
    async (interruptCleanup) => {
      const f = await fixture(capability, { interruptCleanup });
      await pressKey(f.endpoint);
      await expect(cuaRequest(f.endpoint, { method: "stop" })).resolves.toMatchObject({
        ok: false,
      });
      await expect(pressKey(f.endpoint)).resolves.toMatchObject({
        ok: false,
        effect: "not-dispatched",
      });
      expect((await f.events()).filter((event) => event.event === "key")).toHaveLength(1);
    },
  );

  it("interrupts foreground input even when the physical event belongs to a different app", async () => {
    const f = await fixture();
    const hung = cuaRequest(
      f.endpoint,
      {
        method: "call",
        name: "type_text",
        args: { pid: 700, window_id: 900, delivery_mode: "foreground", text: "fixture" },
      },
      { mutation: true },
    );
    await waitForEvent(f, "dispatch");
    expect(f.host.physicalInput({ type: "physical-input", kind: "keyboard", pid: 701 })).toBe(true);
    await expect(hung).resolves.toMatchObject({ ok: false, effect: "dispatched-unknown" });
    await waitForEvent(f, "interrupt-ack");
    expect((await f.events()).filter((event) => event.event === "release")).toHaveLength(1);
  });

  it("starts listener activation only on use and disarms it when the last task ends", async () => {
    let state: ComputerInputMonitorState = { ready: false, error: "input_monitor_idle" };
    const activateInputMonitor = vi.fn(async () => {
      state = { ready: true };
    });
    const onInputMonitorArmedChange = vi.fn((armed: boolean) => {
      if (!armed) state = { ready: false, error: "input_monitor_idle" };
    });
    const f = await fixture(capability, {
      activateInputMonitor,
      onInputMonitorArmedChange,
      inputMonitorState: () => state,
    });
    expect(activateInputMonitor).not.toHaveBeenCalled();
    const task = { threadId: "activation", turnId: "turn" };
    await cuaRequest(f.endpoint, {
      method: "call",
      name: "press_key",
      args: { key: "enter" },
      task,
    });
    expect(activateInputMonitor).toHaveBeenCalledTimes(1);
    await cuaRequest(f.endpoint, { method: "end_task", task });
    expect(onInputMonitorArmedChange).toHaveBeenLastCalledWith(false);
    await cuaRequest(f.endpoint, {
      method: "call",
      name: "press_key",
      args: { key: "enter" },
      task: { ...task, turnId: "next" },
    });
    expect(activateInputMonitor).toHaveBeenCalledTimes(2);
    expect((await f.events()).filter((event) => event.event === "key")).toHaveLength(2);
  });

  it.each(["type_text", "browser_type"])(
    "drains already-dispatched %s when its caller disconnects, without replay or replacement",
    async (name) => {
      const f = await fixture(capability, { browserHang: true, inputDelayMs: 150 });
      const controller = new AbortController();
      const call = cuaRequest(
        f.endpoint,
        {
          method: "call",
          name,
          args: { text: "fixture" },
          task: { threadId: "disconnect", turnId: "turn" },
        },
        { mutation: true, signal: controller.signal },
      ).catch((error: unknown) => error);
      await waitForEvent(f, name === "browser_type" ? "browser-dispatch" : "dispatch");
      controller.abort();
      expect(await call).toMatchObject({ effect: "dispatched-unknown" });
      await waitForEvent(f, "interrupt");

      await expect(pressKey(f.endpoint)).resolves.toMatchObject({ ok: true, result: {} });
      await new Promise((resolve) => setTimeout(resolve, 180));
      const events = (await f.events()).map((event) => event.event);
      expect(events.filter((event) => event === "release")).toHaveLength(1);
      expect(events.filter((event) => event === "start")).toHaveLength(1);
      expect(events.indexOf("key")).toBeGreaterThan(events.indexOf("interrupt-ack"));
      expect(events).not.toContain("effect");
      expect(events).not.toContain("browser-effect");
    },
  );

  it("requires a live Escape listener for browser mutations but keeps browser reads available", async () => {
    let state: ComputerInputMonitorState = { ready: false, error: "event_tap_unavailable" };
    const f = await fixture(capability, { inputMonitorState: () => state });
    const task = { threadId: "listener-browser", turnId: "turn" };
    const action = () =>
      cuaRequest(f.endpoint, { method: "call", name: "browser_navigate", args: {}, task });
    await expect(action()).resolves.toMatchObject({
      result: { structuredContent: { code: "input_monitor_unavailable" } },
    });
    await expect(
      cuaRequest(f.endpoint, { method: "call", name: "get_browser_state", args: {}, task }),
    ).resolves.toMatchObject({ ok: true, result: {} });
    state = { ready: true };
    await expect(action()).resolves.toMatchObject({ ok: true, result: {} });
    expect(
      (await f.events()).filter((event) => event.event.startsWith("browser:browser_navigate:")),
    ).toHaveLength(1);
  });

  it("does not let another task, window, preview, or mismatched read clear native takeover", async () => {
    const f = await fixture();
    const taskA = { threadId: "task-a", turnId: "turn" };
    const taskB = { threadId: "task-b", turnId: "turn" };
    const windowA = { pid: 701, window_id: 901 };
    const windowB = { pid: 700, window_id: 900 };
    const observe = (task: typeof taskA, args: Record<string, unknown>, modelObservation = true) =>
      cuaRequest(f.endpoint, {
        method: "call",
        name: "get_window_state",
        args,
        modelObservation,
        task,
      });
    const click = (task: typeof taskA, args: Record<string, unknown>) =>
      cuaRequest(f.endpoint, {
        method: "call",
        name: "press_key",
        args: { ...args, key: "enter" },
        task,
      });
    await observe(taskA, windowA);
    await observe(taskB, windowB);
    await foregroundCollision(f, taskB, windowB);
    await observe(taskA, windowB);
    await observe(taskB, windowA);
    await observe(taskB, windowB, false);
    await observe(taskB, { ...windowB, fixture_wrong_window: true });
    await cuaRequest(f.endpoint, {
      method: "call",
      name: "get_desktop_state",
      modelObservation: true,
      task: taskB,
    });
    await new Promise((resolve) => setTimeout(resolve, ESCAPE_INPUT_COOLDOWN_MS + 50));
    await expect(click(taskA, windowA)).resolves.toMatchObject({ ok: true, result: {} });
    await expect(click(taskB, windowB)).resolves.toMatchObject({
      result: { structuredContent: { code: "computer_input_paused" } },
      desktopInterruptions: 0,
    });
    await observe(taskB, windowB);
    await expect(click(taskB, windowB)).resolves.toMatchObject({ ok: true, result: {} });
  });

  it("fences input after uncertain focus restoration until a fresh model observation", async () => {
    const result = {
      isError: true,
      structuredContent: { effect: "unverifiable", code: "focus_restore_failed" },
    };
    const f = await fixture(capability, { actionResult: result });
    const task = { threadId: "restore-failure", turnId: "turn" };
    const target = { pid: 700, window_id: 900 };
    const act = () =>
      cuaRequest<CuaReply>(f.endpoint, {
        method: "call",
        name: "press_key",
        args: { ...target, key: "enter" },
        task,
      });
    const read = (modelObservation: boolean) =>
      cuaRequest(f.endpoint, {
        method: "call",
        name: "get_window_state",
        args: target,
        modelObservation,
        task,
      });
    expect((await act()).result).toEqual(result);
    await read(false);
    expect((await act()).result?.structuredContent?.code).toBe("computer_input_paused");
    expect((await f.events()).filter((e) => e.event === "key")).toHaveLength(1);
    await read(true);

    expect((await act()).result).toEqual(result);
    expect((await f.events()).filter((e) => e.event === "key")).toHaveLength(2);
  });

  it("keeps Escape browser recovery separate from native reads and rejects an interrupted browser snapshot", async () => {
    const f = await fixture(capability, {
      browserObservations: true,
      delayBrowserObservation: true,
    });
    const task = { threadId: "browser-escape", turnId: "turn" };
    const window = { pid: 700, window_id: 900 };
    const browser = { target_id: "target-700-900", tab_id: "tab-a" };
    await cuaRequest(f.endpoint, { method: "call", name: "get_browser_state", args: window, task });
    expect(f.host.emergencyStopInput()).toBe(true);
    await waitForEvent(f, "interrupt-ack");
    await cuaRequest(f.endpoint, {
      method: "call",
      name: "get_desktop_state",
      modelObservation: true,
      task,
    });
    await cuaRequest(f.endpoint, {
      method: "call",
      name: "get_browser_state",
      args: window,
      modelObservation: true,
      task,
    });
    const reading = cuaRequest(f.endpoint, {
      method: "call",
      name: "get_browser_state",
      args: browser,
      modelObservation: true,
      task,
    });
    await waitForEvent(f, "browser-observe");
    expect(f.host.emergencyStopInput()).toBe(true);
    await expect(reading).resolves.toMatchObject({
      result: { structuredContent: { code: "computer_input_paused" } },
    });
    await new Promise((resolve) => setTimeout(resolve, ESCAPE_INPUT_COOLDOWN_MS + 50));
    await expect(
      cuaRequest(f.endpoint, { method: "call", name: "browser_navigate", args: browser, task }),
    ).resolves.toMatchObject({ result: { isError: true } });
    await cuaRequest(f.endpoint, {
      method: "call",
      name: "get_browser_state",
      args: browser,
      modelObservation: true,
      task,
    });
    expect(
      (
        await cuaRequest<CuaReply>(f.endpoint, {
          method: "call",
          name: "browser_navigate",
          args: browser,
          task,
        })
      ).result,
    ).toEqual({});
  });
});

describe("verified Linux browser input capability", () => {
  const task = { threadId: "linux-browser", turnId: "turn" };
  async function linuxFixture(options: Parameters<typeof fixture>[1] = {}) {
    return fixture(capability, {
      platform: "linux",
      unpatched: true,
      nativeRevision: null,
      reportedRevision: CUA_NATIVE_REVISION,
      browserInputControl: 1,
      inputMonitorState: () => ({ ready: true }),
      ...options,
    });
  }

  it.each([
    { browserInputControl: undefined },
    { browserInputControl: true },
    { browserInputControl: "1" },
    { reportedRevision: CUA_NATIVE_REVISION - 1 },
  ])("refuses browser input with an unverified child capability %j", async (options) => {
    const f = await linuxFixture(options);
    const reply = await cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "browser_navigate",
      args: { glade_browser_input_control: 1, browserInputControlVerified: true },
      browserInputControlVerified: true,
      task,
    });
    expect(reply).toMatchObject({
      hostPlatform: "linux",
      driverBrowserInputControl: false,
      result: { structuredContent: { code: "linux_browser_cleanup_unavailable" } },
    });
    expect(
      (await f.events()).some((event) => event.event.startsWith("browser:browser_navigate:")),
    ).toBe(false);
  });

  it("requires the embedded metadata PID to match the child before trusting its marker", async () => {
    const f = await linuxFixture({ metadataPidOffset: 1 });
    const reply = await cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "browser_navigate",
      args: {},
      task,
    });
    expect(reply).toMatchObject({
      ok: false,
      effect: "not-dispatched",
      driverBrowserInputControl: false,
    });
    expect(reply.error).toContain("handshake failed");
    expect(
      (await f.events()).some((event) => event.event.startsWith("browser:browser_navigate:")),
    ).toBe(false);
  });

  it("does not spawn or expose the browser marker to an unauthenticated caller", async () => {
    const f = await linuxFixture();
    const reply = await rawCuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "browser_navigate",
      args: {},
      task,
      capability: "not-authorized",
    });
    expect(reply).toMatchObject({
      ok: false,
      effect: "not-dispatched",
      driverBrowserInputControl: false,
    });
    expect(reply.error).toContain("authority");
    await expect(f.events()).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports the Linux Escape diagnosis when listener activation itself fences input", async () => {
    let state: ComputerInputMonitorState = { ready: false, error: "input_monitor_idle" };
    let host: CuaDriverHost;
    const f = await linuxFixture({
      inputMonitorState: () => state,
      activateInputMonitor: async () => {
        state = { ready: false, error: "linux_escape_portal_unverified" };
        host.inputMonitorStateChanged(state);
      },
    });
    host = f.host;

    await cuaRequest(f.endpoint, {
      method: "call",
      name: "get_browser_state",
      args: {},
      task,
    });
    const reply = await cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "browser_prepare",
      args: { allow_launch: true, windowed: false },
      task,
    });
    expect(reply).toMatchObject({
      ok: true,
      result: {
        isError: true,
        structuredContent: {
          effect: "refused",
          code: "input_monitor_unavailable",
          input_monitor_error: "linux_escape_portal_unverified",
        },
      },
    });
    await waitForEvent(f, "interrupt-ack");
    expect(
      (await f.events()).some((event) => event.event.startsWith("browser:browser_prepare:")),
    ).toBe(false);
  });

  it("refuses Linux browser dispatch if its Escape listener is lost during session setup", async () => {
    let checks = 0;
    const f = await linuxFixture({
      inputMonitorState: () =>
        ++checks === 1 ? { ready: true } : { ready: false, error: "linux_escape_shortcut_lost" },
    });
    const reply = await cuaRequest<CuaReply>(f.endpoint, {
      method: "call",
      name: "browser_navigate",
      args: {},
      task,
    });
    expect(reply.result?.structuredContent).toMatchObject({
      code: "input_monitor_unavailable",
      input_monitor_error: "linux_escape_shortcut_lost",
    });
    expect(
      (await f.events()).some((event) => event.event.startsWith("browser:browser_navigate:")),
    ).toBe(false);
  });
});

describe("activation shield host method", () => {
  const task = { threadId: "thread", turnId: "turn" };
  const engageArgs = {
    action: "engage",
    shield_id: "shield-abc123",
    frame: { x: 100, y: 50, width: 400, height: 300 },
    window_id: 4242,
    pid: 777,
    label: "Glade activating Calculator",
  };
  const recordingShield = () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    return {
      calls,
      engage: async (request: unknown, shieldTask?: unknown) => {
        calls.push({ method: "engage", args: [request, shieldTask] });
      },
      release: async (shieldId: string) => {
        calls.push({ method: "release", args: [shieldId] });
      },
      releaseAll: async () => {
        calls.push({ method: "releaseAll", args: [] });
        return calls.filter((call) => call.method === "engage").length;
      },
      endTask: async (ended: unknown) => {
        calls.push({ method: "endTask", args: [ended] });
      },
      stop: async () => {
        calls.push({ method: "stop", args: [] });
      },
      dispose: async () => {
        calls.push({ method: "dispose", args: [] });
      },
    };
  };

  it("release_all is the forced-release path and reports the live count", async () => {
    const shield = recordingShield();
    const f = await fixture(capability, { shield });
    await cuaRequest<CuaReply>(f.endpoint, {
      method: "shield",
      task,
      args: engageArgs,
    });
    const reply = await cuaRequest<CuaReply>(f.endpoint, {
      method: "shield",
      args: { action: "release_all" },
    });
    expect(reply.ok).toBe(true);
    expect(reply.result).toMatchObject({ released: 1 });
    expect(shield.calls.map((call) => call.method)).toEqual(["engage", "releaseAll"]);
  });

  it("stop and dispose release the whole shield surface", async () => {
    const shield = recordingShield();
    const f = await fixture(capability, { shield });
    await f.host.stop();
    expect(shield.calls.map((call) => call.method)).toContain("stop");
  });

  it("shield requests still require host authority", async () => {
    const f = await fixture();
    const socket = createConnection(f.endpoint);
    const reply = await new Promise<Record<string, unknown>>((resolve, reject) => {
      socket.once("connect", () => {
        socket.write(
          JSON.stringify({
            method: "shield",
            args: { action: "release_all" },
          }) + "\n",
        );
      });
      socket.once("data", (chunk) => {
        try {
          resolve(JSON.parse(chunk.toString()));
        } catch (error) {
          reject(error);
        }
      });
      socket.once("error", reject);
    });
    socket.destroy();
    expect(reply.ok).toBe(false);
    expect(String(reply.error)).toContain("authority");
  });
});
