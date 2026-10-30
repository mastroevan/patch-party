import { useEffect, useRef, useState } from "react";
import type { PartyState } from "../../../packages/contracts";
export function useSoundCues(state: PartyState | null) {
  const [enabled, setEnabled] = useState(false);
  const context = useRef<AudioContext | null>(null),
    previous = useRef("");
  const chirp = (frequency: number) => {
    const ctx = context.current;
    if (!ctx || ctx.state !== "running") return;
    const oscillator = ctx.createOscillator(),
      gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.055, ctx.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.17);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.18);
  };
  async function toggle() {
    if (enabled) {
      setEnabled(false);
      return;
    }
    try {
      context.current ??= new AudioContext();
      await context.current.resume();
      setEnabled(true);
      chirp(660);
    } catch {
      setEnabled(false);
    }
  }
  useEffect(() => {
    if (!state) return;
    const key = `${state.sessionId}:${state.roundId}:${state.phase}:${state.build.status}:${state.ballot}`;
    if (enabled && previous.current && previous.current !== key) {
      if (state.build.status === "failed") chirp(220);
      else if (state.phase === "reveal") chirp(880);
      else if (state.build.status === "ready") chirp(740);
      else if (state.phase === "playing" && state.ballot === "voting")
        chirp(520);
    }
    previous.current = key;
  }, [
    state?.sessionId,
    state?.roundId,
    state?.phase,
    state?.build.status,
    state?.ballot,
    enabled,
  ]);
  useEffect(
    () => () => {
      void context.current?.close();
    },
    [],
  );
  return { enabled, toggle };
}
