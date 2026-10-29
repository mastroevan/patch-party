import type { RuleId } from "../contracts/index.ts";
export function modifiers(rule: RuleId, effectMs: number) {
  return {
    gravity:
      rule === "moon" ? 430 : rule === "gravity" && effectMs > 0 ? -850 : 850,
    speed: rule === "sprint" && effectMs > 0 ? 390 : 230,
    jump: rule === "moon" ? 420 : 440,
  };
}
export function advanceEffect(
  remaining: number,
  delta: number,
  paused: boolean,
) {
  return paused ? remaining : Math.max(0, remaining - delta);
}
