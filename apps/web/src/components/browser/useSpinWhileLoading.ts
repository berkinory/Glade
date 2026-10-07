import { useEffect, useRef } from "react";

const TURN_MS = 800;

// Spins the element while `loading` and, when loading ends, finishes the current turn with an
// ease-out instead of snapping back. Reduced motion keeps it still.
export function useSpinWhileLoading<T extends Element>(loading: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    if (!loading || !element) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const spin = element.animate([{ rotate: "0deg" }, { rotate: "360deg" }], {
      duration: TURN_MS,
      iterations: Infinity,
    });
    return () => {
      const elapsed = Number(spin.currentTime ?? 0) % TURN_MS;
      spin.cancel();
      const from = (elapsed / TURN_MS) * 360;
      element.animate([{ rotate: `${from}deg` }, { rotate: "360deg" }], {
        duration: Math.max(240, ((360 - from) / 360) * TURN_MS * 1.6),
        easing: "cubic-bezier(0.2, 0, 0, 1)",
      });
    };
  }, [loading]);
  return ref;
}
