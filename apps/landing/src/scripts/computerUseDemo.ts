// Drives the Computer Use illustration: a scripted 13-second loop of an agent filling in a form with
// Cua's cursor. Positions come from the rendered controls, so the markup can change freely.

type Step =
  | { at: number; kind: "move"; to: string; duration: number }
  | { at: number; kind: "click"; target: string }
  | { at: number; kind: "type"; target: string; text: string; perChar: number }
  | { at: number; kind: "set"; target: string; attribute: string; value: string }
  | { at: number; kind: "reset" };

const LOOP_SECONDS = 13;
const NOTES = "Faster sync and a calmer sidebar.";

const steps: ReadonlyArray<Step> = [
  { at: 0.5, kind: "move", to: "version", duration: 0.95 },
  { at: 1.55, kind: "click", target: "version" },
  { at: 1.75, kind: "type", target: "version", text: "2.4.0", perChar: 0.11 },
  { at: 2.6, kind: "move", to: "beta", duration: 0.7 },
  { at: 3.4, kind: "click", target: "beta" },
  { at: 3.45, kind: "set", target: "channel", attribute: "data-value", value: "beta" },
  { at: 3.85, kind: "move", to: "notes", duration: 0.65 },
  { at: 4.6, kind: "click", target: "notes" },
  { at: 4.75, kind: "type", target: "notes", text: NOTES, perChar: 0.045 },
  { at: 6.4, kind: "move", to: "notify", duration: 0.7 },
  { at: 7.2, kind: "click", target: "notify" },
  { at: 7.25, kind: "set", target: "notify", attribute: "aria-checked", value: "true" },
  { at: 7.65, kind: "move", to: "publish", duration: 0.75 },
  { at: 8.55, kind: "click", target: "publish" },
  { at: 8.65, kind: "set", target: "stage", attribute: "data-published", value: "true" },
  { at: 9.3, kind: "move", to: "rest", duration: 1.1 },
  { at: 11.6, kind: "reset" },
];

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function mountComputerUseDemo(root: HTMLElement): void {
  const stage = root.querySelector<HTMLElement>("[data-demo-stage]");
  const cursor = root.querySelector<HTMLElement>("[data-demo-cursor]");
  const toggle = root.querySelector<HTMLButtonElement>("[data-demo-toggle]");
  if (!stage || !cursor) return;
  const part = (name: string) => stage.querySelector<HTMLElement>(`[data-part="${name}"]`);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // The stage is laid out at 1200 by 740 and scaled to fit, so every coordinate below is in that space.
  let scale = 1;
  const fit = () => {
    scale = root.clientWidth / 1200;
    stage.style.setProperty("--scale", String(scale));
  };
  new ResizeObserver(fit).observe(root);
  fit();

  const anchor = (name: string): [number, number] => {
    if (name === "rest") return [1010, 600];
    const element = part(name);
    if (!element) return [1010, 600];
    const box = element.getBoundingClientRect();
    const origin = stage.getBoundingClientRect();
    const x = (box.left - origin.left) / scale;
    const y = (box.top - origin.top) / scale;
    // Aim a little inside the control, the way a pointer lands on a button rather than its corner.
    return [x + Math.min(box.width / scale - 14, 46), y + box.height / scale / 2 + 2];
  };

  const typed = new Map<string, string>();
  const writeText = (target: string, value: string) => {
    if (typed.get(target) === value) return;
    typed.set(target, value);
    const element = part(target);
    const slot = element?.querySelector<HTMLElement>("[data-text]");
    if (slot) slot.textContent = value;
    element?.toggleAttribute("data-filled", value.length > 0);
  };

  const applyState = (time: number) => {
    let focus = "";
    for (const name of ["version", "notes"]) writeText(name, "");
    part("channel")?.setAttribute("data-value", "stable");
    part("notify")?.setAttribute("aria-checked", "false");
    stage.removeAttribute("data-published");
    for (const step of steps) {
      if (step.at > time) break;
      if (step.kind === "click" && (step.target === "version" || step.target === "notes")) {
        focus = step.target;
      } else if (step.kind === "click") {
        focus = "";
      } else if (step.kind === "type") {
        const count = Math.min(step.text.length, Math.floor((time - step.at) / step.perChar) + 1);
        writeText(step.target, step.text.slice(0, count));
      } else if (step.kind === "set") {
        const element = step.target === "stage" ? stage : part(step.target);
        element?.setAttribute(step.attribute, step.value);
      }
    }
    const resetting = time >= 11.6;
    stage.toggleAttribute("data-resetting", resetting && time < 12.4);
    if (resetting && time >= 12.0) {
      for (const name of ["version", "notes"]) writeText(name, "");
      part("channel")?.setAttribute("data-value", "stable");
      part("notify")?.setAttribute("aria-checked", "false");
      stage.removeAttribute("data-published");
    }
    for (const name of ["version", "notes"]) {
      part(name)?.toggleAttribute("data-focused", focus === name && time < 9.3);
    }
  };

  const position = (time: number): { x: number; y: number; moving: boolean } => {
    let from: [number, number] = anchor("rest");
    for (const step of steps) {
      if (step.kind !== "move") continue;
      const to = anchor(step.to);
      if (time < step.at) break;
      if (time < step.at + step.duration) {
        const t = easeInOut((time - step.at) / step.duration);
        // A gentle arc: the control point sits off the straight line, like a hand moving a mouse.
        const mx = (from[0] + to[0]) / 2 + (to[1] - from[1]) * 0.12;
        const my = (from[1] + to[1]) / 2 - (to[0] - from[0]) * 0.12;
        const x = (1 - t) ** 2 * from[0] + 2 * (1 - t) * t * mx + t * t * to[0];
        const y = (1 - t) ** 2 * from[1] + 2 * (1 - t) * t * my + t * t * to[1];
        return { x, y, moving: true };
      }
      from = to;
    }
    return { x: from[0], y: from[1], moving: false };
  };

  const clickAt = (time: number) =>
    steps.some((step) => step.kind === "click" && time >= step.at && time < step.at + 0.42);
  const pressAt = (time: number) =>
    steps.some((step) => step.kind === "click" && time >= step.at && time < step.at + 0.12);

  const render = (time: number) => {
    applyState(time);
    const { x, y, moving } = position(time);
    cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    cursor.toggleAttribute("data-moving", moving);
    cursor.toggleAttribute("data-pressed", pressAt(time));
    cursor.toggleAttribute("data-clicking", clickAt(time));
  };

  if (reduced) {
    stage.setAttribute("data-static", "");
    render(10.5);
    return;
  }

  let playing = true;
  let visible = false;
  let started = 0;
  let pausedAt = 0;
  let frame = 0;
  const tick = (now: number) => {
    render(((now - started) / 1000) % LOOP_SECONDS);
    frame = requestAnimationFrame(tick);
  };
  const run = () => {
    if (frame || !playing || !visible) return;
    started = performance.now() - pausedAt * 1000;
    frame = requestAnimationFrame(tick);
  };
  const halt = () => {
    if (!frame) return;
    cancelAnimationFrame(frame);
    frame = 0;
    pausedAt = ((performance.now() - started) / 1000) % LOOP_SECONDS;
  };
  render(0);
  new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? false;
    if (visible) run();
    else halt();
  }).observe(root);
  toggle?.addEventListener("click", () => {
    playing = !playing;
    toggle.dataset.playing = String(playing);
    toggle.setAttribute("aria-label", playing ? "Pause the animation" : "Play the animation");
    if (playing) run();
    else halt();
  });
}
