import { useEffect, useRef } from "react";
import completeSoundUrl from "./sounds/complete.wav";
import waitingSoundUrl from "./sounds/waiting.wav";

type ActivitySound = "complete" | "waiting";

export function useActivitySound(enabled: boolean) {
  const playbackRef = useRef<{ sound: ActivitySound; audio: HTMLAudioElement } | null>(null);

  useEffect(() => {
    return () => {
      playbackRef.current?.audio.pause();
      playbackRef.current = null;
    };
  }, [enabled]);

  return (sound: ActivitySound): void => {
    if (!enabled) return;
    const current = playbackRef.current;
    // Coalesce bursts and let an input request interrupt a completion cue, never the reverse.
    if (current && !current.audio.paused && (current.sound === sound || sound === "complete")) {
      return;
    }
    current?.audio.pause();
    const audio = new Audio(sound === "complete" ? completeSoundUrl : waitingSoundUrl);
    playbackRef.current = { sound, audio };
    void audio.play().catch((error: unknown) => {
      if (playbackRef.current?.audio !== audio) return;
      playbackRef.current = null;
      console.warn("Could not play activity sound", error);
    });
  };
}
